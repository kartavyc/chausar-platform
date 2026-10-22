import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { SAMPLE_MOVE_CODE, SAMPLE_PASSPHRASE, SAMPLE_RECOVERY_CODE } from '../../src/engine/fixtures';
import type { BackupLite, BusinessList, EngineError, MoveFile, WorkspaceStatusLite } from '../../src/engine/types';

/**
 * The fake keeps the custody rules of platform/runtime/engine.ts and workspace-custody-contracts.ts: one business open
 * at a time, a backup restore that is confirmed and writes a safety copy first, a move file that needs its code, a
 * recovery code that opens a business whose key is lost, and a delete that needs the business name typed.
 */
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as EngineError);
const status = (engine: FakeEngine) => engine.request('workspace.status', {}) as Promise<WorkspaceStatusLite>;
const list = (engine: FakeEngine) => engine.request('workspace.list', {}) as Promise<BusinessList>;

describe('fake engine: opening and closing', () => {
  it('a passphrase business opens only with its passphrase; a wrong one is refused', async () => {
    const engine = new FakeEngine({ closed: true });
    expect(await refusal(engine.request('workspace.open', { folder: 'sitara' }))).toMatchObject({ code: 'PASSPHRASE_REQUIRED' });
    expect(await refusal(engine.request('workspace.open', { folder: 'sitara', passphrase: 'not the passphrase' }))).toMatchObject({ code: 'UNLOCK_FAILED' });
    await engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE });
    expect(await status(engine)).toMatchObject({ open: true, workspace: { name: 'Sitara Events' } });
  });

  it("a business whose key is missing does not open; this computer's words say why", async () => {
    const engine = new FakeEngine({ closed: true, keyMissing: ['ledgerline'] });
    expect((await list(engine)).businesses.find((b) => b.folder === 'ledgerline')?.opens).toBe('key-missing');
    expect(await refusal(engine.request('workspace.open', { folder: 'ledgerline' }))).toMatchObject({ code: 'DEVICE_KEY_FAILED', message: "This computer's key didn't open your business. Use your recovery code, or a backup with it." });
  });

  it('lock closes the business and says the owner closed it', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.lock', {});
    expect(await status(engine)).toMatchObject({ open: false, closedByOwner: true });
    expect(await refusal(engine.request('venture.get', {}))).toMatchObject({ code: 'VAULT_LOCKED' });
  });
});

describe('fake engine: the recovery code', () => {
  it('opens a business whose key is missing, and this computer keeps the key again', async () => {
    const engine = new FakeEngine({ closed: true, keyMissing: ['ledgerline'] });
    expect(await refusal(engine.request('workspace.recover', { folder: 'ledgerline', recoveryCode: 'WRONG-CODE' }))).toMatchObject({ code: 'UNLOCK_FAILED' });
    await engine.request('workspace.recover', { folder: 'ledgerline', recoveryCode: SAMPLE_RECOVERY_CODE });
    expect(await status(engine)).toMatchObject({ open: true, workspace: { name: 'Ledgerline' } });
    await engine.request('workspace.lock', {});
    expect((await list(engine)).businesses.find((b) => b.folder === 'ledgerline')?.opens).toBe('with-this-computer');
  });

  it('without protected storage asks for a new passphrase, then that passphrase opens it', async () => {
    const engine = new FakeEngine({ closed: true, deviceKeys: false });
    expect(await refusal(engine.request('workspace.recover', { folder: 'sitara', recoveryCode: SAMPLE_RECOVERY_CODE }))).toMatchObject({ code: 'DEVICE_KEYS_UNAVAILABLE' });
    expect(await refusal(engine.request('workspace.recover', { folder: 'sitara', recoveryCode: SAMPLE_RECOVERY_CODE, passphrase: 'short' }))).toMatchObject({ code: 'WEAK_PASSPHRASE' });
    await engine.request('workspace.recover', { folder: 'sitara', recoveryCode: SAMPLE_RECOVERY_CODE, passphrase: 'a brand new passphrase' });
    await engine.request('workspace.lock', {});
    expect(await refusal(engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE }))).toMatchObject({ code: 'UNLOCK_FAILED' });
    await engine.request('workspace.open', { folder: 'sitara', passphrase: 'a brand new passphrase' });
  });

  it('refuses while a business is open', async () => {
    const engine = new FakeEngine();
    expect(await refusal(engine.request('workspace.recover', { folder: 'ledgerline', recoveryCode: SAMPLE_RECOVERY_CODE }))).toMatchObject({ code: 'VAULT_OPEN' });
  });
});

describe('fake engine: backups', () => {
  it('with no business open, lists every backup on this computer, newest first, each with its business name', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.backups.create', {});
    await engine.request('workspace.lock', {});
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    expect(new Set(backups.map((b) => b.name))).toEqual(new Set(['Lumen Studio', 'Ledgerline', 'Sitara Events']));
    expect([...backups].sort((a, b) => b.at.localeCompare(a.at))).toEqual(backups);
  });

  it('restoring the open business needs confirmed, writes a safety copy first, and refuses another business\'s backup', async () => {
    const engine = new FakeEngine();
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    const file = backups[0]!.file;
    expect(await refusal(engine.request('workspace.backups.restore', { file } as never))).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const restored = (await engine.request('workspace.backups.restore', { file, confirmed: true })) as { restoredFrom: BackupLite; safety: BackupLite };
    expect(restored.restoredFrom.file).toBe(file);
    expect(restored.safety.kind).toBe('safety');
    const after = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    expect(after.backups[0]!.kind).toBe('safety');
    await engine.request('workspace.lock', {});
    const all = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    const other = all.backups.find((b) => b.name === 'Ledgerline')!;
    await engine.request('workspace.open', { folder: 'lumen' });
    expect(await refusal(engine.request('workspace.backups.restore', { file: other.file, confirmed: true }))).toMatchObject({ code: 'BACKUP_OTHER_BUSINESS' });
  });

  it('with no business open, a backup opens as a new business beside the old one; a passphrase backup asks for it first', async () => {
    const engine = new FakeEngine({ closed: true });
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    const lumen = backups.find((b) => b.name === 'Lumen Studio')!;
    const made = (await engine.request('workspace.restore', { backupFile: lumen.file, folder: null })) as { folder: string };
    expect(made.folder).toBe('lumen-restored');
    expect(await status(engine)).toMatchObject({ open: true, workspace: { name: 'Lumen Studio' } });
    await engine.request('workspace.lock', {});
    const sitara = backups.find((b) => b.name === 'Sitara Events')!;
    expect(await refusal(engine.request('workspace.restore', { backupFile: sitara.file, folder: null }))).toMatchObject({ code: 'PASSPHRASE_REQUIRED' });
    await engine.request('workspace.restore', { backupFile: sitara.file, folder: null, passphrase: SAMPLE_PASSPHRASE });
    await engine.request('workspace.lock', {});
    expect(await refusal(engine.request('workspace.restore', { backupFile: 'not-here.backup', folder: null }))).toMatchObject({ code: 'BACKUP_NOT_FOUND' });
  });
});

describe('fake engine: moving a business', () => {
  it('makes one file and one code; the code opens the file on another computer, and only there', async () => {
    const here = new FakeEngine();
    const move = (await here.request('workspace.transfer.export', {})) as MoveFile;
    expect(move.transferCode).toBe(SAMPLE_MOVE_CODE);
    expect(move.fileName).toMatch(/^chausar-move-\d{4}-\d{2}-\d{2}\.backup$/);
    const there = new FakeEngine({ fresh: true });
    expect(await refusal(there.request('workspace.transfer.import', { fileText: move.text, transferCode: 'CHT-WRONG' }))).toMatchObject({ code: 'TRANSFER_CODE_WRONG' });
    expect(await refusal(there.request('workspace.transfer.import', { fileText: 'not a move file', transferCode: move.transferCode }))).toMatchObject({ code: 'TRANSFER_INVALID' });
    expect(await refusal(there.request('workspace.transfer.import', { fileText: 'x'.repeat(1_900_001), transferCode: move.transferCode }))).toMatchObject({ code: 'TRANSFER_TOO_LARGE' });
    await there.request('workspace.transfer.import', { fileText: move.text, transferCode: move.transferCode });
    expect(await status(there)).toMatchObject({ open: true, workspace: { name: 'Lumen Studio' } });
    await here.request('workspace.lock', {});
    expect(await refusal(here.request('workspace.transfer.import', { fileText: move.text, transferCode: move.transferCode }))).toMatchObject({ code: 'TRANSFER_SAME_BUSINESS' });
  });

  it('a business locked with a passphrase moves only with it', async () => {
    const engine = new FakeEngine({ closed: true });
    await engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE });
    expect(await refusal(engine.request('workspace.transfer.export', {}))).toMatchObject({ code: 'PASSPHRASE_WRONG' });
    expect(await refusal(engine.request('workspace.transfer.export', { passphrase: 'not the passphrase' }))).toMatchObject({ code: 'PASSPHRASE_WRONG' });
    await engine.request('workspace.transfer.export', { passphrase: SAMPLE_PASSPHRASE });
  });
});

describe('fake engine: export and delete', () => {
  it('export needs confirmed; plaintext is said to be not encrypted', async () => {
    const engine = new FakeEngine();
    expect(await refusal(engine.request('workspace.export', { plaintext: false } as never))).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await engine.request('workspace.export', { confirmed: true, plaintext: false })).toMatchObject({ encrypted: true, path: expect.stringMatching(/\.vault$/) });
    expect(await engine.request('workspace.export', { confirmed: true, plaintext: true })).toMatchObject({ encrypted: false, path: expect.stringMatching(/\.json$/) });
  });

  it('delete needs the name exactly; it removes the business and its backups and closes it', async () => {
    const engine = new FakeEngine();
    expect(await refusal(engine.request('workspace.delete', { confirmation: 'lumen studio' }))).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const gone = await engine.request('workspace.delete', { confirmation: 'Lumen Studio' });
    expect(gone).toMatchObject({ deleted: true, externalCopies: 'Copies made outside this app must be removed by their owner.' });
    expect(await status(engine)).toMatchObject({ open: false });
    expect((await list(engine)).businesses.map((b) => b.folder)).toEqual(['ledgerline', 'sitara']);
    const { backups } = (await engine.request('workspace.backups.list', {})) as { backups: BackupLite[] };
    expect(backups.some((b) => b.name === 'Lumen Studio')).toBe(false);
  });
});
