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
function start(hash: string, engine = new FakeEngine(), transport?: Transport) {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: Calls = [];
  const client: EngineClient = {
    ...fake,
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
  if (!node.open) fireEvent.click(within(node).getByText(summary, { selector: 'summary' }));
  return node;
};
async function press(button: HTMLElement) { await act(async () => { fireEvent.click(button); }); }
async function sitara() {
  const engine = new FakeEngine({ closed: true });
  await engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE });
  return engine;
}

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

describe('Keep this business: all backups and their restore', () => {
  it('lists every backup with its kind and how it opens; a restore asks first and sends nothing until confirmed', async () => {
    const { calls } = start('#/business/keep');
    const all = await fold('All backups, 3');
    const rows = within(all).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Automatic. Opens the way your business opens now.'),
      expect.stringContaining('Before a change. Opens the way your business opens now.'),
      expect.stringContaining('You made it. Opens with an older passphrase or code.'),
    ]);
    await press(within(rows[2]!).getByRole('button', { name: 'Restore' }));
    expect(within(rows[2]!).getByText('Your business goes back to how it was then. Chausar saves a copy of how it is now first.')).toBeTruthy();
    expect(sent(calls, 'workspace.backups.restore')).toEqual([]);
    await press(within(rows[2]!).getByRole('button', { name: 'Keep it as it is' }));
    expect(within(rows[2]!).queryByRole('button', { name: 'Restore this copy' })).toBeNull();
    expect(sent(calls, 'workspace.backups.restore')).toEqual([]);

    await press(within(rows[0]!).getByRole('button', { name: 'Restore' }));
    await press(within(rows[0]!).getByRole('button', { name: 'Restore this copy' }));
    expect(sent(calls, 'workspace.backups.restore')).toEqual([{ file: 'chausar-lumen-auto.backup', confirmed: true }]);
    // The business is read again from the engine: the safety copy of how it was is now the newest backup.
    const after = await fold('All backups, 4');
    expect(within(after).getAllByRole('listitem')[0]!.textContent).toContain('Before a change.');
  });

  it("a refused restore shows the engine's words and keeps the business as it is", async () => {
    const engine = new FakeEngine();
    const { calls } = start('#/business/keep', engine);
    const all = await fold('All backups, 3');
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
    expect(within(box).getByText(/^Saved to \/Users\/you\/Chausar\/exports\/chausar-lumen-\d+\.vault$/)).toBeTruthy();

    fireEvent.click(within(box).getByRole('radio', { name: 'Readable, not encrypted' }));
    expect(within(box).getByText('Anyone who opens a readable copy can read everything in it: clients, invoices and notes.')).toBeTruthy();
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(within(box).getByRole('alert').textContent).toBe('Tick the box to make a readable copy.');
    expect(sent(calls, 'workspace.export')).toHaveLength(1);
    fireEvent.click(within(box).getByRole('checkbox', { name: 'I understand. Make it readable.' }));
    await press(within(box).getByRole('button', { name: 'Export a copy' }));
    expect(sent(calls, 'workspace.export')).toEqual([{ confirmed: true, plaintext: false }, { confirmed: true, plaintext: true }]);
    expect(within(box).getByText(/^Saved to .*\.json$/)).toBeTruthy();
    expect(within(box).getByText("This copy isn't encrypted. Delete it once you're done with it.")).toBeTruthy();
  });
});

describe('Keep this business: delete this business', () => {
  it('says what it removes and what it cannot; it needs the exact name, then goes to Welcome back without opening another', async () => {
    const engine = new FakeEngine({ only: ['lumen', 'ledgerline'] });
    const { calls } = start('#/business/keep', engine);
    const box = await fold('Delete this business');
    expect(await within(box).findByText("This deletes Lumen Studio from this computer, with its backups and exports in Chausar's folders.")).toBeTruthy();
    expect(within(box).getByText("It can't delete copies kept anywhere else, like a move file or an export you saved somewhere else.")).toBeTruthy();
    const name = within(box).getByLabelText('Type Lumen Studio to delete it') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'lumen studio' } });
    await press(within(box).getByRole('button', { name: 'Delete this business' }));
    expect(within(box).getByRole('alert').textContent).toBe("Type the name exactly as it's shown.");
    expect(sent(calls, 'workspace.delete')).toEqual([]);
    fireEvent.change(name, { target: { value: 'Lumen Studio' } });
    await press(within(box).getByRole('button', { name: 'Delete this business' }));
    expect(sent(calls, 'workspace.delete')).toEqual([{ confirmation: 'Lumen Studio' }]);
    expect(await screen.findByText('Copies made outside this app must be removed by their owner.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Businesses on this computer' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ledgerline']);
    expect(sent(calls, 'workspace.open')).toEqual([]);
    expect(((await engine.request('workspace.status', {})) as WorkspaceStatusLite).open).toBe(false);
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    expect(backups.some((b) => b.name === 'Lumen Studio')).toBe(false);
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
