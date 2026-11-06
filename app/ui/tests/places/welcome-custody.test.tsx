import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { CUSTODY_ERROR_WORDS, SAMPLE_MOVE_CODE, SAMPLE_PASSPHRASE, SAMPLE_RECOVERY_CODE } from '../../src/engine/fixtures';
import type { EngineClient, MoveFile, Transport } from '../../src/engine/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Welcome back carries every way in the old renderer had (platform/tests/venture-onboarding-renderer.test.ts, the
 * Welcome back, recover, restore and move sections): a passphrase asked under its own row and cleared once sent, the
 * recovery code from the list, a backup restored by its name, a business moved here with its file and code, and a
 * typed folder when the list can't show every business. A new passphrase is asked only after the engine says this
 * computer can't keep the key.
 */
type Calls = [string, Record<string, unknown>][];
function start(options: FakeOptions, { engine = new FakeEngine(options), transport }: { engine?: FakeEngine; transport?: Transport } = {}) {
  window.location.hash = '#/today';
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
async function press(button: HTMLElement) { await act(async () => { fireEvent.click(button); }); }
const welcome = () => screen.findByRole('heading', { level: 1, name: 'Welcome back' });
const appShown = () => screen.findByRole('navigation', { name: 'Places' });
/** B4 task 12: the other ways in: links at rest when there are two, in one chooser when there are more. */
async function moreOption(name: string) {
  const chooser = screen.queryByText('Bring a business here');
  if (chooser) fireEvent.click(chooser);
  await press(await screen.findByRole('button', { name }));
}

describe('Welcome back: a business locked with a passphrase', () => {
  it('asks under its own row, focused; sends folder and passphrase once, keeps a wrong one in the field, and never shows it', async () => {
    const { calls } = start({ closed: true });
    await welcome();
    await press(screen.getByRole('button', { name: /Sitara Events/ }));
    const field = screen.getByLabelText('Passphrase for Sitara Events') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(document.activeElement).toBe(field);
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('data-variant') === 'primary').map((b) => b.textContent)).toEqual(['Open']);
    await press(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter your passphrase.');
    expect(sent(calls, 'workspace.open')).toEqual([]);

    fireEvent.change(field, { target: { value: 'not the passphrase' } });
    await press(screen.getByRole('button', { name: 'Open' }));
    // C4 task 35 (31.f2): a wrong one stays in the field with the cursor, to fix a typo.
    expect(field.value).toBe('not the passphrase');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('alert').textContent).toBe("That passphrase didn't open it. Check Caps Lock and try again, or use your recovery code.");

    fireEvent.change(field, { target: { value: SAMPLE_PASSPHRASE } });
    await press(screen.getByRole('button', { name: 'Open' }));
    await appShown();
    expect(sent(calls, 'workspace.open')).toEqual([{ folder: 'sitara', passphrase: 'not the passphrase' }, { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE }]);
    expect(document.body.textContent).not.toContain(SAMPLE_PASSPHRASE);
    // C4 task 35 (32.x1): one quiet line on Today's first view, once.
    expect(await screen.findByText('Opened. It will ask again next time.')).toBeTruthy();
    cleanup();
    start({ only: ['lumen'] });
    await appShown();
    expect(screen.queryByText('Opened. It will ask again next time.')).toBeNull();
  });

  it('under React StrictMode a wrong passphrase still shows the refusal and Open works again (U16)', async () => {
    window.location.hash = '#/today';
    render(<StrictMode><App client={createFakeClient(new FakeEngine({ closed: true }))} language="en" /></StrictMode>);
    await welcome();
    await press(screen.getByRole('button', { name: /Sitara Events/ }));
    const field = screen.getByLabelText('Passphrase for Sitara Events') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'not the passphrase' } });
    await press(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("That passphrase didn't open it. Check Caps Lock and try again, or use your recovery code."));
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false);
    expect(field.value).toBe('not the passphrase');
  });

  it('a forgotten passphrase leads to the recovery code, with that business chosen', async () => {
    const { calls } = start({ closed: true });
    await welcome();
    await press(screen.getByRole('button', { name: /Sitara Events/ }));
    await press(screen.getByRole('button', { name: 'Forgot it? Use your recovery code' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Use your recovery code' })).toBeTruthy();
    expect((screen.getByLabelText('Business') as HTMLSelectElement).value).toBe('sitara');
    const code = screen.getByLabelText('Recovery code') as HTMLInputElement;
    expect(code.type).toBe('password');
    fireEvent.change(code, { target: { value: SAMPLE_RECOVERY_CODE } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    await appShown();
    expect(sent(calls, 'workspace.recover')).toEqual([{ folder: 'sitara', recoveryCode: SAMPLE_RECOVERY_CODE }]);
  });
});

describe('Welcome back: the card holds still (B4 task 5)', () => {
  it('the card is anchored to the top, so an error line grows down and does not move it', async () => {
    start({ closed: true });
    await welcome();
    const main = screen.getByRole('main');
    expect(main.hasAttribute('data-anchored')).toBe(true);
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Entry.module.css'), 'utf8');
    expect(/\.firstMain\[data-anchored\] \{([^}]*)\}/.exec(css)![1]).toContain('align-content: start');
  });
});

describe('Welcome back: the recovery code', () => {
  it("a business whose key is missing goes straight to its recovery code; no new passphrase while this computer can keep the key", async () => {
    const { calls } = start({ closed: true, keyMissing: ['ledgerline'] });
    await welcome();
    const row = screen.getByRole('button', { name: /Ledgerline/ });
    expect(row.textContent).toContain('Opens with its recovery code');
    await press(row);
    expect((screen.getByLabelText('Business') as HTMLSelectElement).value).toBe('ledgerline');
    expect(screen.queryByLabelText('New passphrase')).toBeNull();
    await press(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByRole('alert').textContent).toBe('Type your recovery code first.');
    expect(sent(calls, 'workspace.recover')).toEqual([]);
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'WRONG-CODE' } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByRole('alert').textContent).toBe("That passphrase didn't open it. Check Caps Lock and try again, or use your recovery code.");
    expect((screen.getByLabelText('Recovery code') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: SAMPLE_RECOVERY_CODE } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    await appShown();
    expect(sent(calls, 'workspace.recover').at(-1)).toEqual({ folder: 'ledgerline', recoveryCode: SAMPLE_RECOVERY_CODE });
  });

  it("without protected storage the engine's reason shows, then a new passphrase typed twice goes with the code", async () => {
    const { calls } = start({ closed: true, deviceKeys: false });
    await welcome();
    await moreOption('Use a recovery code');
    fireEvent.change(screen.getByLabelText('Business'), { target: { value: 'ledgerline' } });
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: SAMPLE_RECOVERY_CODE } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    expect(sent(calls, 'workspace.recover')).toEqual([{ folder: 'ledgerline', recoveryCode: SAMPLE_RECOVERY_CODE }]);
    expect(screen.getByText('This computer has no keyring Chausar can use, so Chausar asks for a passphrase.')).toBeTruthy();
    expect((screen.getByLabelText('Recovery code') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: SAMPLE_RECOVERY_CODE } });
    fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'another long passphrase' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'another long passphrase!' } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByRole('alert').textContent).toBe("The two passphrases don't match.");
    expect(sent(calls, 'workspace.recover')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'another long passphrase' } });
    await press(screen.getByRole('button', { name: 'Recover' }));
    await appShown();
    expect(sent(calls, 'workspace.recover').at(-1)).toEqual({ folder: 'ledgerline', recoveryCode: SAMPLE_RECOVERY_CODE, passphrase: 'another long passphrase' });
  });
});

describe('Welcome back: restore a backup', () => {
  it('lists the backups on this computer by business, newest first, and restores one by its name, never a path', async () => {
    const { calls } = start({ closed: true });
    await welcome();
    await moreOption('Restore a backup');
    expect(screen.getByRole('heading', { level: 1, name: 'Restore a backup' })).toBeTruthy();
    const lumen = await screen.findByRole('list', { name: 'Lumen Studio' });
    expect(within(lumen).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Automatic'), expect.stringContaining('Before a change'), expect.stringContaining('You made it'),
    ]);
    await press(within(within(lumen).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Restore' }));
    await appShown();
    expect(sent(calls, 'workspace.restore')).toEqual([{ backupFile: 'chausar-lumen-auto.backup', folder: null }]);
  });

  it("a passphrase backup asks for it in its row after the engine says so, sends it once and clears it", async () => {
    const { calls } = start({ closed: true });
    await welcome();
    await moreOption('Restore a backup');
    fireEvent.click(await screen.findByText('Sitara Events', { selector: 'summary' }));
    const row = within(await screen.findByRole('list', { name: 'Sitara Events' })).getAllByRole('listitem')[0]!;
    await press(within(row).getByRole('button', { name: 'Restore' }));
    expect(within(row).getByText(CUSTODY_ERROR_WORDS.PASSPHRASE_REQUIRED)).toBeTruthy();
    const field = within(row).getByLabelText('Passphrase') as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: SAMPLE_PASSPHRASE } });
    await press(within(row).getByRole('button', { name: 'Restore' }));
    await appShown();
    expect(sent(calls, 'workspace.restore')).toEqual([
      { backupFile: 'chausar-sitara-auto.backup', folder: null },
      { backupFile: 'chausar-sitara-auto.backup', folder: null, passphrase: SAMPLE_PASSPHRASE },
    ]);
  });

  it("a backup whose key is missing asks for the recovery code after the engine's words", async () => {
    const { calls } = start({ closed: true, keyMissing: ['ledgerline'] });
    await welcome();
    await moreOption('Restore a backup');
    fireEvent.click(await screen.findByText('Ledgerline', { selector: 'summary' }));
    const row = within(await screen.findByRole('list', { name: 'Ledgerline' })).getAllByRole('listitem')[0]!;
    await press(within(row).getByRole('button', { name: 'Restore' }));
    expect(within(row).getByText(CUSTODY_ERROR_WORDS.DEVICE_KEY_FAILED)).toBeTruthy();
    fireEvent.change(within(row).getByLabelText('Recovery code'), { target: { value: SAMPLE_RECOVERY_CODE } });
    await press(within(row).getByRole('button', { name: 'Restore' }));
    await appShown();
    expect(sent(calls, 'workspace.restore').at(-1)).toEqual({ backupFile: 'chausar-ledgerline-auto.backup', folder: null, recoveryCode: SAMPLE_RECOVERY_CODE });
  });
});

describe('Welcome back: move a business here', () => {
  async function moveFile(): Promise<MoveFile> {
    return (await new FakeEngine().request('workspace.transfer.export', {})) as MoveFile;
  }
  const choose = (text: string, name = 'chausar-move-2026-10-22.backup') => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], name, { type: 'application/json' })] } });
  };

  it("Chausar's button opens the file chooser; the code sits outside any form; the file and code go once, a wrong code stays to fix", async () => {
    const move = await moveFile();
    const { calls } = start({ fresh: true });
    await press(await screen.findByRole('button', { name: 'Open a business you already have' }));
    expect(await screen.findByText('Chausar found no business on this computer.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Move from another computer' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Move a business here' })).toBeTruthy();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // C4 task 38 (218.d1): the move file's own extension first; an older .backup move file still opens.
    expect(input.accept).toBe('.chausar-move,.backup,application/json');
    // C4 task 38 (214.x1): how the file gets here.
    expect(screen.getByText('Bring the file by USB stick, Google Drive or WhatsApp to yourself.')).toBeTruthy();
    let picked = 0;
    input.addEventListener('click', () => { picked++; });
    await press(screen.getByText('Choose the move file'));
    expect(picked).toBe(1);
    const code = screen.getByLabelText('The move code') as HTMLInputElement;
    expect(code.type).toBe('password');
    expect(code.autocomplete).toBe('off');
    expect(code.closest('form')).toBeNull();
    // B4: Move it here waits for the file and the code, and says which.
    const go = () => screen.getByRole('button', { name: 'Move it here' }) as HTMLButtonElement;
    expect(screen.getByRole('button', { name: 'Move it here', description: 'Choose the move file first.' })).toHaveProperty('disabled', true);
    choose(move.text);
    expect(screen.getByText('chausar-move-2026-10-22.backup')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move it here', description: 'Type the move code first.' })).toHaveProperty('disabled', true);
    fireEvent.change(code, { target: { value: 'CHT-WRONG' } });
    expect(go().disabled).toBe(false);
    await press(screen.getByRole('button', { name: 'Move it here' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(CUSTODY_ERROR_WORDS.TRANSFER_CODE_WRONG));
    // B4 task 12: what was typed stays, so a typo can be fixed.
    expect(code.value).toBe('CHT-WRONG');
    // B4: the wrong code marks its field and its words describe it.
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(code.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    fireEvent.change(code, { target: { value: SAMPLE_MOVE_CODE } });
    expect(code.getAttribute('aria-invalid')).toBeNull();
    // C4 task 38: a stale error goes as soon as the owner types (222); the name and day inside show before Move it here.
    expect(screen.queryByRole('alert')).toBeNull();
    const peeked = await screen.findByText(/^This file holds Lumen Studio, moved out .+\.$/);
    expect(peeked.closest('[role="status"]')).not.toBeNull();
    expect(sent(calls, 'workspace.transfer.peek')).toEqual([{ fileText: move.text, transferCode: SAMPLE_MOVE_CODE }]);
    await press(screen.getByRole('button', { name: 'Move it here' }));
    await appShown();
    expect(sent(calls, 'workspace.transfer.import')).toEqual([
      { fileText: move.text, transferCode: 'CHT-WRONG' },
      { fileText: move.text, transferCode: SAMPLE_MOVE_CODE },
    ]);
  });

  it('a business already on this computer: Move it here waits for another file (B4)', async () => {
    const move = await moveFile();
    start({ closed: true });
    await welcome();
    await press(screen.getByRole('button', { name: 'Move from another computer' }));
    choose(move.text);
    fireEvent.change(screen.getByLabelText('The move code'), { target: { value: SAMPLE_MOVE_CODE } });
    await press(screen.getByRole('button', { name: 'Move it here' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(CUSTODY_ERROR_WORDS.TRANSFER_SAME_BUSINESS));
    fireEvent.change(screen.getByLabelText('The move code'), { target: { value: SAMPLE_MOVE_CODE } });
    expect(screen.getByRole('button', { name: 'Move it here', description: 'Choose another file' })).toHaveProperty('disabled', true);
    choose(move.text, 'another.backup');
    expect(screen.getByRole('button', { name: 'Move it here' })).toHaveProperty('disabled', false);
  });

  it('a business already on this computer: the line carries Open <name>, which opens it (B4)', async () => {
    const move = await moveFile();
    const { calls } = start({ closed: true });
    await welcome();
    await press(screen.getByRole('button', { name: 'Move from another computer' }));
    choose(move.text);
    fireEvent.change(screen.getByLabelText('The move code'), { target: { value: SAMPLE_MOVE_CODE } });
    await press(screen.getByRole('button', { name: 'Move it here' }));
    await press(await screen.findByRole('button', { name: `Open ${(JSON.parse(move.text) as { name: string }).name}` }));
    await appShown();
    expect(sent(calls, 'workspace.open').length).toBe(1);
  });

  it('a file bigger than the engine takes is refused before it is sent', async () => {
    const { calls } = start({ closed: true });
    await welcome();
    await press(screen.getByRole('button', { name: 'Move from another computer' }));
    choose('x'.repeat(1_900_001));
    fireEvent.change(screen.getByLabelText('The move code'), { target: { value: SAMPLE_MOVE_CODE } });
    await press(screen.getByRole('button', { name: 'Move it here' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(CUSTODY_ERROR_WORDS.TRANSFER_TOO_LARGE));
    expect(sent(calls, 'workspace.transfer.import')).toEqual([]);
  });
});

describe('Welcome back: open by folder name', () => {
  /** The engine could not list every business here (PostgreSQL storage, say). */
  function incomplete() {
    const engine = new FakeEngine({ closed: true });
    const original = engine.request.bind(engine);
    engine.request = (async (method: string, params?: unknown) => {
      const reply = await original(method, params);
      return method === 'workspace.list' ? { ...(reply as object), complete: false } : reply;
    }) as typeof engine.request;
    return engine;
  }

  it('is not offered while the list shows every business here', async () => {
    start({ closed: true });
    await welcome();
    expect(screen.queryByRole('button', { name: 'Find it on this computer' })).toBeNull();
  });

  it('with an incomplete list, sends the folder alone, and the passphrase only when one is typed, then clears it', async () => {
    const { calls } = start({}, { engine: incomplete() });
    await welcome();
    await moreOption('Find it on this computer');
    expect(screen.getByRole('heading', { level: 1, name: 'Find it on this computer' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'sitara' } });
    await press(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert').textContent).toBe(CUSTODY_ERROR_WORDS.PASSPHRASE_REQUIRED);
    const passphrase = screen.getByLabelText('Passphrase, if it has one') as HTMLInputElement;
    expect(passphrase.type).toBe('password');
    fireEvent.change(passphrase, { target: { value: SAMPLE_PASSPHRASE } });
    await press(screen.getByRole('button', { name: 'Open' }));
    await appShown();
    expect(sent(calls, 'workspace.open')).toEqual([{ folder: 'sitara' }, { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE }]);
  });

  it('on a computer with no business, the typed folder is offered and a folder with nothing in it is said plainly', async () => {
    const { calls } = start({ fresh: true });
    await press(await screen.findByRole('button', { name: 'Open a business you already have' }));
    await moreOption('Find it on this computer');
    expect((screen.getByLabelText('Folder') as HTMLInputElement).value).toBe('main');
    await press(screen.getByRole('button', { name: 'Open' }));
    expect(sent(calls, 'workspace.open')).toEqual([{ folder: 'main' }]);
    expect(screen.getByRole('alert').textContent).toBe("There's no business in that folder on this computer.");
  });
});

describe('Welcome back on hosted', () => {
  it('shows the list and Start only, and never asks for a custody method', async () => {
    const { calls } = start({ closed: true, hosted: true }, { transport: 'hosted' });
    await welcome();
    expect(screen.queryByText('More options')).toBeNull();
    expect(screen.queryByText('Bring a business here')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore a backup' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move from another computer' })).toBeNull();
    expect(calls.some(([m]) => m.startsWith('workspace.custody.') || ['workspace.list', 'workspace.backups.list', 'workspace.transfer.import', 'workspace.recover', 'workspace.restore'].includes(m))).toBe(false);
  });
});
