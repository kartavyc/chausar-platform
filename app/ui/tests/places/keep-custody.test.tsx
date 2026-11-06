import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { SAMPLE_MOVE_CODE, SAMPLE_PASSPHRASE } from '../../src/engine/fixtures';
import { EngineError, type BackupLite, type EngineClient, type MoveFile, type Transport, type WorkspaceStatusLite } from '../../src/engine/types';

/**
 * Keep this business (#/business/keep) carries every custody action the old renderer's "Your workspace" menu and its
 * Trust & access panel had: all backups with a restore that asks first, moving to another computer, closing or
 * locking the business, an export (encrypted, or readable after a second ask) and deleting it with its name typed.
 * The behaviour rules come from platform/tests/custody-renderer.test.ts and the old app.js workspace menu.
 */
type Calls = [string, Record<string, unknown>][];
function start(hash: string, engine = new FakeEngine(), transport?: Transport, extra: Partial<EngineClient> = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: Calls = [];
  const client: EngineClient = {
    ...fake,
    ...extra,
    transport: transport ?? fake.transport,
    request: ((method: string, params?: Record<string, unknown>) => {
      calls.push([method, structuredClone(params ?? {})]);
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return { engine, calls };
}
const sent = (calls: Calls, method: string) => calls.filter(([m]) => m === method).map(([, p]) => p);
const fold = async (summary: string | RegExp) => {
  const node = (await screen.findByText(summary, { selector: 'summary' })).closest('details')!;
  if (!node.open) await press(within(node).getByText(summary, { selector: 'summary' }));
  return node;
};
async function press(button: HTMLElement) { await act(async () => { fireEvent.click(button); }); }
async function allBackups(count?: number) {
  const section = await screen.findByRole('region', { name: 'Backups' });
  const older = within(section).queryByText(/^\d+ older backups$/, { selector: 'summary' });
  if (older && !older.closest('details')!.open) await press(older);
  if (count !== undefined) await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(count));
  return section;
}
async function sitara() {
  const engine = new FakeEngine({ closed: true });
  await engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE });
  return engine;
}

it.each(['Export a copy', 'Delete this business'])('brings the opened %s section into view', async summary => {
  start('#/business/keep');
  const item = (await screen.findByText(summary, { selector: 'summary' })).closest('details')!;
  const scroll = vi.fn();
  item.scrollIntoView = scroll;
  await fold(summary);
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
});

it('keeps only the chosen custody action passphrase open and clears the previous one', async () => {
  start('#/business/keep', await sitara());
  const recovery = await screen.findByRole('region', { name: 'Recovery code' });
  await press(within(recovery).getByRole('button', { name: 'Make a new one' }));
  fireEvent.change(within(recovery).getByLabelText('Your passphrase'), { target: { value: 'an unfinished secret' } });
  await fold('Move to another computer');
  expect(screen.getByRole('main').querySelectorAll('input[type="password"]')).toHaveLength(1);
  expect(within(recovery).queryByLabelText('Your passphrase')).toBeNull();
  await press(within(recovery).getByRole('button', { name: 'Make a new one' }));
  expect(screen.getByRole('main').querySelectorAll('input[type="password"]')).toHaveLength(1);
  expect((within(recovery).getByLabelText('Your passphrase') as HTMLInputElement).value).toBe('');
});

/** Captures the file the page hands the owner: its name, type and exact text. */
function catchSaves() {
  const saved: { name: string; type: string; text: Promise<string> }[] = [];
  let blob: Blob | null = null;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (value: Blob) => { blob = value; return 'blob:chausar/1'; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    if (blob) saved.push({ name: this.download, type: blob.type, text: blob.text() });
  });
  return saved;
}

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  Reflect.deleteProperty(navigator, 'clipboard');
});

it('desktop file custody is beta-grade', async () => {
  const desktop = start('#/business/keep', new FakeEngine(), 'desktop');
  await allBackups(3);
  expect(sent(desktop.calls, 'workspace.custody.get').length).toBeGreaterThan(0);
  expect(screen.queryByText(/experimental storage/)).toBeNull();
});

describe('Keep this business: all backups and their restore', () => {
  it('lists every backup with its kind and how it opens; a restore asks first and sends nothing until confirmed', async () => {
    const { calls } = start('#/business/keep');
    const all = await allBackups(3);
    const rows = within(all).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Automatic. Opens the way your business opens now.'),
      expect.stringContaining('Before a change. Opens the way your business opens now.'),
      expect.stringContaining('You made it. Opens with an older passphrase or code.'),
    ]);
    await press(within(rows[2]!).getByRole('button', { name: 'Restore' }));
    // C6: the ask leads with what restoring takes back (the sample's manual copy, from before many changes).
    expect(await within(rows[2]!).findByText(/^Since .*: 1 client, 5 orders, 2 invoices and 1 payment added, 1 client, 2 orders and 1 invoice changed. Restoring takes these back. How it is now is saved as a backup first.$/)).toBeTruthy();
    expect(sent(calls, 'workspace.backups.restore')).toEqual([]);
    await press(within(rows[2]!).getByRole('button', { name: 'Keep it as it is' }));
    expect(within(rows[2]!).queryByRole('button', { name: 'Restore this copy' })).toBeNull();
    expect(sent(calls, 'workspace.backups.restore')).toEqual([]);

    await press(within(rows[0]!).getByRole('button', { name: 'Restore' }));
    await press(within(rows[0]!).getByRole('button', { name: 'Restore this copy' }));
    expect(sent(calls, 'workspace.backups.restore')).toEqual([{ file: 'chausar-lumen-auto.backup', confirmed: true }]);
    // The business is read again from the engine: the safety copy of how it was is now the newest backup.
    const after = await allBackups(4);
    expect(within(after).getAllByRole('listitem')[0]!.textContent).toContain('Before a change.');
  });

  it("a refused restore shows the engine's words and keeps the business as it is", async () => {
    const engine = new FakeEngine();
    const { calls } = start('#/business/keep', engine);
    const all = await allBackups(3);
    const row = within(all).getAllByRole('listitem')[1]!;
    const original = engine.request.bind(engine);
    vi.spyOn(engine, 'request').mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'workspace.backups.restore') throw new EngineError('BACKUP_OTHER_BUSINESS', 'This backup belongs to another business.');
      return original(method, params);
    });
    await press(within(row).getByRole('button', { name: 'Restore' }));
    await press(within(row).getByRole('button', { name: 'Restore this copy' }));
    expect(within(row).getByRole('alert').textContent).toBe("Couldn't do that: This backup belongs to another business.");
    expect(sent(calls, 'workspace.backups.restore')).toHaveLength(1);
  });
});

describe('Keep this business: moving to another computer', () => {
  it('makes one file and one code; the code shows in groups of four, Save gives the file unchanged, Copy gives the code', async () => {
    const saved = catchSaves();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { calls } = start('#/business/keep');
    const move = await fold('Move to another computer');
    expect(within(move).getByText('Chausar makes one file and one code. On the other computer, choose Move from another computer, then give it both.')).toBeTruthy();
    expect(within(move).queryByLabelText(/passphrase/i)).toBeNull();
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    expect(sent(calls, 'workspace.transfer.export')).toEqual([{}]);
    const code = within(move).getByRole('group', { name: 'Move code' });
    const groups = [...code.querySelectorAll('span')].map((part) => part.textContent ?? '');
    expect(groups.join('')).toBe(SAMPLE_MOVE_CODE);
    expect(groups.slice(0, -1).every((part) => part.length === 4)).toBe(true);
    await press(within(move).getByRole('button', { name: 'Save the file' }));
    const expected = (await new FakeEngine().request('workspace.transfer.export', {})) as MoveFile;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe(expected.fileName);
    expect(saved[0]!.type).toBe('application/json');
    expect(JSON.parse(await saved[0]!.text)).toMatchObject({ business: 'lumen', name: 'Lumen Studio' });
    await press(within(move).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(SAMPLE_MOVE_CODE);
    expect(within(move).getByText("Anyone with this file and this code can open your business. Keep them apart, and delete the file once you've moved.")).toBeTruthy();
    expect(within(move).getByText("The business stays on this computer too. Changes on one computer don't reach the other.")).toBeTruthy();
    // Done forgets the code and the file: neither stays on the page.
    await press(within(move).getByRole('button', { name: 'Done' }));
    expect(document.body.textContent).not.toContain(SAMPLE_MOVE_CODE);
    expect(within(move).getByRole('button', { name: 'Make the file' })).toBeTruthy();
  });

  it('a business locked with a passphrase asks for it, sends it once, clears it, and shows a wrong one in the engine words', async () => {
    const { calls } = start('#/business/keep', await sitara());
    const move = await fold('Move to another computer');
    const field = within(move).getByLabelText('Your passphrase') as HTMLInputElement;
    expect(field.type).toBe('password');
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    expect(within(move).getByRole('alert').textContent).toBe('Enter your passphrase.');
    expect(sent(calls, 'workspace.transfer.export')).toEqual([]);
    fireEvent.change(field, { target: { value: 'not the passphrase' } });
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    expect(field.value).toBe('');
    expect(within(move).getByRole('alert').textContent).toBe("Couldn't do that: That passphrase doesn't match.");
    fireEvent.change(field, { target: { value: SAMPLE_PASSPHRASE } });
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    expect(sent(calls, 'workspace.transfer.export')).toEqual([{ passphrase: 'not the passphrase' }, { passphrase: SAMPLE_PASSPHRASE }]);
    expect(within(move).getByRole('group', { name: 'Move code' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(SAMPLE_PASSPHRASE);
  });

  // C4 task 38 (219.x1): the line stays after Done, with its local time, until the owner takes it away.
  it('a made file leaves a lasting line with its time; Dismiss takes it away', async () => {
    const { calls } = start('#/business/keep');
    const move = await fold('Move to another computer');
    expect(screen.queryByText(/^Move file made /)).toBeNull();
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    await waitFor(() => expect(screen.getByText(/^Move file made .+. Delete it once the move is done.$/)).toBeTruthy());
    expect(within(move).getByRole('group', { name: 'Move code' })).toBeTruthy();
    await press(within(move).getByRole('button', { name: 'Done' }));
    expect(screen.getByText(/^Move file made /)).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(sent(calls, 'workspace.transfer.export').at(-1)).toEqual({ dismiss: true });
    await waitFor(() => expect(screen.queryByText(/^Move file made /)).toBeNull());
  });

  // C4 task 38 (217.x1): no recovery code yet: the fold says to make one first, with its button.
  it('with no recovery code the fold says to make one first, and its button shows the code', async () => {
    const engine = new FakeEngine({ fresh: true });
    await engine.request('workspace.create', { name: 'Kite Studio', pack: 'services' });
    const { calls } = start('#/business/keep', engine);
    const move = await fold('Move to another computer');
    expect(within(move).getByText('Make a recovery code first, in case the move goes wrong.')).toBeTruthy();
    await press(within(move).getByRole('button', { name: 'Make the code' }));
    expect(sent(calls, 'workspace.custody.recoveryCode')).toHaveLength(1);
    expect(await screen.findByRole('group', { name: 'Recovery code' })).toBeTruthy();
  });

  it('with a recovery code the fold does not ask for one', async () => {
    start('#/business/keep');
    const move = await fold('Move to another computer');
    expect(within(move).queryByText('Make a recovery code first, in case the move goes wrong.')).toBeNull();
  });
});

describe('Keep this business: closing and locking', () => {
  it('Close this business closes it once and goes to Welcome back, where it waits to be opened again', async () => {
    const { calls } = start('#/business/keep');
    expect(await screen.findByText('It opens again without a passphrase on this computer.')).toBeTruthy();
    await press(await screen.findByRole('button', { name: 'Close this business' }));
    expect(sent(calls, 'workspace.lock')).toEqual([{}]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
    expect(screen.queryByText('Keep this business')).toBeNull();
    expect(sent(calls, 'workspace.open')).toEqual([]);
    await press(screen.getByRole('button', { name: 'Lumen Studio' }));
    await screen.findByRole('navigation', { name: 'Places' });
    expect(window.location.hash).toBe('#/today');
  });

  it('a business locked with a passphrase says Lock, and asks for its passphrase to open again', async () => {
    const { calls } = start('#/business/keep', await sitara());
    expect(await screen.findByText('It asks for your passphrase to open again.')).toBeTruthy();
    await press(await screen.findByRole('button', { name: 'Lock this business' }));
    expect(sent(calls, 'workspace.lock')).toEqual([{}]);
    const row = await screen.findByRole('button', { name: /Sitara Events/ });
    expect(row.textContent).toContain('Opens with its passphrase');
  });
});

describe('Keep this business: export a copy', () => {
  it('an encrypted copy by default; a readable one only after a second ask, and it says so', async () => {
    const { calls } = start('#/business/keep');
    const box = await fold('Export a copy');
    expect((within(box).getByRole('radio', { name: 'Encrypted' }) as HTMLInputElement).checked).toBe(true);
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(sent(calls, 'workspace.export')).toEqual([{ confirmed: true, plaintext: false }]);
    // C4 task 36: the saved line names the file, never a path on this computer.
    expect(within(box).getByText(/^Saved chausar-lumen-\d+\.vault\.$/)).toBeTruthy();
    expect(box.textContent).not.toContain('/Users/');

    fireEvent.click(within(box).getByRole('radio', { name: 'Readable, not encrypted' }));
    expect(within(box).getByText('Anyone who opens a readable copy can read everything in it: clients, invoices and notes.')).toBeTruthy();
    // B4: no red line before anything was pressed. The button waits and says why; the old "Saved to" line goes with the old choice.
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(within(box).queryByText(/^Saved to /)).toBeNull();
    expect(within(box).getByRole('button', { name: 'Export a copy', description: 'Tick the box to make a readable copy.' })).toHaveProperty('disabled', true);
    expect(sent(calls, 'workspace.export')).toHaveLength(1);
    fireEvent.click(within(box).getByRole('checkbox', { name: 'I understand. Make it readable.' }));
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(sent(calls, 'workspace.export')).toEqual([{ confirmed: true, plaintext: false }, { confirmed: true, plaintext: true }]);
    expect(within(box).getByText(/^Saved chausar-lumen-\d+\.json\.$/)).toBeTruthy();
    expect(within(box).getByText("This copy isn't encrypted. Delete it once you're done with it.")).toBeTruthy();
  });
});

describe('C4 task 36: backups and export', () => {
  it('on the desktop, Export asks where to save; the saved line names the file and offers Show in folder; a cancel says nothing', async () => {
    const saveBusinessExport = vi.fn(async (_plaintext: boolean) => ({ name: 'Pune Frames, 3 Nov 2026.vault', encrypted: true, id: 'a1b2c3d4e5f6a7b8c9' }) as { name: string; encrypted: boolean; id: string } | null);
    const showSavedExport = vi.fn(async (_id: string) => {});
    const { calls } = start('#/business/keep', new FakeEngine(), 'desktop', { saveBusinessExport, showSavedExport });
    const box = await fold('Export a copy');
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(saveBusinessExport).toHaveBeenCalledWith(false);
    expect(sent(calls, 'workspace.export')).toEqual([]);
    const said = within(box).getByRole('status');
    expect(said.textContent).toContain('Saved Pune Frames, 3 Nov 2026.vault.');
    await press(within(said).getByRole('button', { name: 'Show in folder' }));
    expect(showSavedExport).toHaveBeenCalledWith('a1b2c3d4e5f6a7b8c9');
    saveBusinessExport.mockResolvedValueOnce(null);
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(within(box).queryByRole('status')).toBeNull();
  });

  it('Back up now says "Backed up just now"; each backup shows its size; after a restore one line says where it went back to', async () => {
    const { calls } = start('#/business/keep');
    const backupNow = await screen.findByRole('button', { name: 'Back up now' });
    await press(backupNow);
    expect(sent(calls, 'workspace.backups.create')).toHaveLength(1);
    expect((await screen.findByText('Backed up just now')).closest('[role="status"]')).not.toBeNull();
    const all = await allBackups();
    const rows = within(all).getAllByRole('listitem');
    expect(rows.at(-1)!.textContent).toContain('47 KB');
    await press(within(rows[0]!).getByRole('button', { name: 'Restore' }));
    await press(within(rows[0]!).getByRole('button', { name: 'Restore this copy' }));
    const line = await screen.findByText(/^Back to .+\. How it was a moment ago is saved as a backup\.$/);
    expect(line.closest('[role="status"]')).not.toBeNull();
  });
});

describe('Keep this business: delete this business', () => {
  it('says what it removes and what it cannot; it needs the exact name, then goes to Welcome back without opening another', async () => {
    const engine = new FakeEngine({ only: ['lumen', 'ledgerline'] });
    const { calls } = start('#/business/keep', engine);
    const box = await fold('Delete this business');
    expect(await within(box).findByText('This deletes Lumen Studio and its backups from this computer. Copies you exported stay.')).toBeTruthy();
    expect(within(box).getByText("It can't delete a move file or a copy kept somewhere else.")).toBeTruthy();
    // C4 task 37: what goes and what stays, from the custody view, and a copy first.
    expect(box.querySelector('[data-delete-counts]')?.textContent).toBe('This removes 3 backups.');
    await press(within(box).getByRole('button', { name: 'Export a copy first' }));
    expect(((await screen.findByText('Export a copy', { selector: 'summary' })).closest('details') as HTMLDetailsElement).open).toBe(true);
    const name = within(box).getByLabelText('Type Lumen Studio to delete it') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'lumen studio' } });
    // B4: Delete stays dim until the name matches, and says so.
    await press(within(box).getByRole('button', { name: 'Delete this business', description: 'Type the business name to delete it' }));
    expect(sent(calls, 'workspace.delete')).toEqual([]);
    fireEvent.change(name, { target: { value: 'Lumen Studio' } });
    await press(within(box).getByRole('button', { name: 'Delete this business' }));
    expect(sent(calls, 'workspace.delete')).toEqual([{ confirmation: 'Lumen Studio' }]);
    // B3: Delete goes straight to Welcome back, which says what was deleted; there is no Continue to press.
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByText('Copies made outside this app must be removed by their owner.')).toBeTruthy();
    expect(screen.getByText('Lumen Studio is deleted. 3 backups removed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Businesses on this computer' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['LedgerlineOpen']);
    expect(sent(calls, 'workspace.open')).toEqual([]);
    expect(((await engine.request('workspace.status', {})) as WorkspaceStatusLite).open).toBe(false);
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    expect(backups.some((b) => b.name === 'Lumen Studio')).toBe(false);
  });

  it('review of A1 row 1: after Delete it lists the exported copies it kept, says which is readable, and shows one in its folder', async () => {
    const engine = new FakeEngine({ only: ['lumen', 'ledgerline'] });
    const shown: string[] = [];
    const client = createFakeClient(engine);
    const sealed = (await client.request('workspace.export', { confirmed: true, plaintext: false })) as { path: string };
    const readable = (await client.request('workspace.export', { confirmed: true, plaintext: true })) as { path: string };
    start('#/business/keep', engine, undefined, { showExport: async (name: string) => { shown.push(name); } });
    const box = await fold('Delete this business');
    // C4 task 37: the two exports made above stay, and the line says so.
    await waitFor(() => expect(box.querySelector('[data-delete-counts]')?.textContent).toBe('This removes 3 backups. Your 2 exports stay.'));
    fireEvent.change(await within(box).findByLabelText('Type Lumen Studio to delete it'), { target: { value: 'Lumen Studio' } });
    await press(within(box).getByRole('button', { name: 'Delete this business' }));
    expect(await screen.findByText('These copies you exported are still on this computer:')).toBeTruthy();
    // B3: the deleted business leaves at once: no rail, no name, Welcome back with what was deleted and kept.
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Deleted' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Businesses on this computer' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['LedgerlineOpen']);
    expect(screen.getByText('Copies made outside this app must be removed by their owner.')).toBeTruthy();
    const names = [sealed.path, readable.path].map((path) => path.split('/').pop()!);
    for (const name of names) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText("Readable, not encrypted. Delete it once you're done with it.")).toHaveLength(1);
    await press(screen.getAllByRole('button', { name: 'Show in folder' })[0]!);
    expect(shown).toEqual([names[0]]);
  });

  it('the name typed is the name the vault holds, not the working name', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const renamed: EngineClient = { ...client, request: (async (method: string, params?: unknown) => {
      const reply = await client.request(method as 'venture.get', params as Record<string, never>);
      if (method === 'venture.get' && reply) return { ...reply, venture: { ...reply.venture, workingName: 'Lumen Audio Reviews' } };
      return reply;
    }) as EngineClient['request'] };
    window.location.hash = '#/business/keep';
    render(<App client={renamed} language="en" />);
    const box = await fold('Delete this business');
    expect(await within(box).findByLabelText('Type Lumen Studio to delete it')).toBeTruthy();
  });

  it('on hosted, only Delete is offered: no close, move, restore or export, which the server keeps for itself', async () => {
    start('#/business/keep', new FakeEngine({ hosted: true }), 'hosted');
    await fold('Delete this business');
    expect(screen.queryByRole('button', { name: 'Close this business' })).toBeNull();
    expect(screen.queryByText('Move to another computer')).toBeNull();
    expect(screen.queryByText('Export a copy')).toBeNull();
    expect(screen.queryByText(/^All backups/)).toBeNull();
  });
});

describe('Keep this business: the recovery code shown once', () => {
  it('Save as file gives the exact code on its own line, only when the owner asks; Done forgets it', async () => {
    const saved = catchSaves();
    start('#/business/keep');
    await press(await screen.findByRole('button', { name: 'Make a new one' }));
    const code = (await screen.findByRole('group', { name: 'Recovery code' })).textContent!;
    expect(saved).toHaveLength(0);
    await press(screen.getByRole('button', { name: 'Save as file' }));
    expect(saved.map((file) => [file.name, file.type])).toEqual([['chausar-recovery-code.txt', 'text/plain']]);
    const lines = (await saved[0]!.text).split('\n');
    expect(lines).toContain(code);
    expect(lines).toContain('Folder: lumen');
    fireEvent.click(screen.getByRole('checkbox', { name: "I've saved it somewhere safe" }));
    await press(screen.getByRole('button', { name: 'Done' }));
    expect(document.body.textContent).not.toContain(code);
  });

  // C4 task 35 (25.x1): Print is a view of the code and the business name, nothing else, gone after the print.
  it('Print opens the print view with the code and the business name only; it goes after printing', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    start('#/business/keep');
    await press(await screen.findByRole('button', { name: 'Make a new one' }));
    const code = (await screen.findByRole('group', { name: 'Recovery code' })).textContent!;
    expect(document.querySelector('[data-print-view]')).toBeNull();
    await press(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    const view = document.querySelector('[data-print-view]')!;
    expect(view.textContent).toContain(code);
    expect(view.textContent).toContain('Lumen Studio');
    expect(view.querySelectorAll('button, input, a')).toHaveLength(0);
    await act(async () => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.querySelector('[data-print-view]')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('Keep this business: secrets', () => {
  it('nothing typed or shown once is kept on the page after it was used', async () => {
    const { calls } = start('#/business/keep', await sitara());
    const move = await fold('Move to another computer');
    fireEvent.change(within(move).getByLabelText('Your passphrase'), { target: { value: SAMPLE_PASSPHRASE } });
    await press(within(move).getByRole('button', { name: 'Make the file' }));
    await press(within(move).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.body.textContent).not.toContain(SAMPLE_MOVE_CODE));
    for (const input of document.querySelectorAll('input')) expect(input.value).not.toBe(SAMPLE_PASSPHRASE);
    expect(sent(calls, 'workspace.transfer.export')).toEqual([{ passphrase: SAMPLE_PASSPHRASE }]);
  });
});

// One-shot C6 task 2 (SCREENS 204.f1, 208.x1, 213.x1): what is in each backup, and what a restore takes back.
describe('Keep this business: what is in a backup, and what a restore takes back', () => {
  it("\"What's in it\" is closed at rest and asks the engine once, when opened", async () => {
    const { calls } = start('#/business/keep');
    const all = await allBackups(3);
    expect(sent(calls, 'workspace.backups.inspect')).toEqual([]);
    const row = within(all).getAllByRole('listitem')[0]!;
    const inside = within(row).getByText("What's in it", { selector: 'summary' }).closest('details')!;
    expect(inside.open).toBe(false);
    fireEvent.click(within(inside).getByText("What's in it", { selector: 'summary' }));
    expect(await within(inside).findByText('3 clients, 12 orders, 4 invoices and 3 payments')).toBeTruthy();
    expect(sent(calls, 'workspace.backups.inspect')).toEqual([{ file: 'chausar-lumen-auto.backup' }]);
  });

  it('the restore ask leads with what changed since, before the button, and the restore still makes its safety copy', async () => {
    const { calls } = start('#/business/keep');
    const all = await allBackups(3);
    const row = within(all).getAllByRole('listitem')[0]!;
    await press(within(row).getByRole('button', { name: 'Restore' }));
    const change = await within(row).findByText(/^Since .*: 2 orders and 1 invoice added, 1 client changed\. Restoring takes these back\. How it is now is saved as a backup first\.$/);
    const go = within(row).getByRole('button', { name: 'Restore this copy' });
    expect(change.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await press(go);
    expect(sent(calls, 'workspace.backups.restore')).toEqual([{ file: 'chausar-lumen-auto.backup', confirmed: true }]);
    const after = await allBackups(4);
    expect(within(after).getAllByRole('listitem')[0]!.textContent).toContain('Before a change.');
  });

  it('with nothing changed since, the ask says so', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.backups.create', {});
    start('#/business/keep', engine);
    const all = await allBackups(4);
    const row = within(all).getAllByRole('listitem')[0]!;
    await press(within(row).getByRole('button', { name: 'Restore' }));
    expect(await within(row).findByText('Nothing changed since then. How it is now is saved as a backup first.')).toBeTruthy();
  });
});
