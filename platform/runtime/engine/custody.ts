

import { resolve, join, relative, isAbsolute } from 'node:path';

import { readdir, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

import { STORE_LIMIT_BYTES, Vault, readBoundedText, safeDirectory } from '../vault.ts';

import { authorize, audit, check, ChausarError, newId, now, type Context } from '../contracts.ts';
import type { BusinessSnapshot, BusinessSnapshotRead } from '../venture/contracts.ts';

import { deviceKeyFailed, deviceKeysUnavailable, noDeviceKeyStore, osDeviceKeyStore, type DeviceKeyRecord, type DeviceKeyStore, type ProbeResult } from '../device-custody.ts';
import { DriveBackup, driveClientOfBuild, type DriveTokens } from '../drive-backup.ts';
import { CustodyFiles, MANAGED_COPY_TAIL, backupDue, backupName, computerView, keepBackups, makeTransferCode, newCard, nextBackupAt, nextFolder, normalizeTransferCode, parseBackupName, type VaultCard } from '../workspace-custody.ts';

import { CUSTODY_WORDS, TRANSFER, exportFileName, moveFileName, type BackupCopyView, type BackupInspectView, type BackupKind, type BackupView, type CopyImportResult, type CustodyView, type DriveStatus, type RecoveryState } from '../workspace-custody-contracts.ts';
import { SNAPSHOT_FORMAT, WorkspaceSnapshots, snapshotDue } from '../workspace-snapshots.ts';
import { transferHint, moveMadeOf, copyViewOf } from './shared.ts';
import type { EngineInternals } from './internals.ts';

export async function managedExports(internals: EngineInternals): Promise<string[]> {
    const folder = resolve(internals.options.directory, 'exports'), prefix = `chausar-${internals.store().read().workspace.id}-`;
    let files;
    try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') return []; throw error; }
    return files.filter(file => file.isFile() && file.name.startsWith(prefix) && MANAGED_COPY_TAIL.test(file.name.slice(prefix.length))).map(file => join(folder, file.name)).sort();
  }

export async function purgeManagedCopies(internals: EngineInternals, folders: readonly ('backups' | 'exports')[] = ['backups', 'exports']): Promise<string[]> {
    // A whole-workspace fork can hold forgotten bytes from another source. Revoke
    // surviving receipt contexts BEFORE deleting those copies; never retain the
    // forgotten fork solely to satisfy an unrelated receipt's interpretation.
    const vault = internals.store(), current = vault.read();
    if (current.receipts.some(receipt => receipt.restatement && !current.tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receipt.id)))) {
      await vault.update(state => {
        const receiptIds = state.receipts.filter(receipt => receipt.restatement && !state.tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receipt.id))).map(receipt => receipt.id).sort();
        if (receiptIds.length) state.tombstones.push({ id: newId('tombstone'), kind: 'private-restatement-custody', receiptIds,
          reason: 'managed-retention-or-deletion', deletedAt: now() });
      });
    }
    const removed: string[] = await internals.store().purgeArtifacts();
    const prefix = `chausar-${internals.store().read().workspace.id}-`;
    for (const name of folders) {
      const folder = resolve(internals.options.directory, name); let files;
      try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') continue; throw error; }
      for (const file of files) if (file.isFile() && file.name.startsWith(prefix) && MANAGED_COPY_TAIL.test(file.name.slice(prefix.length))) { const path = resolve(folder, file.name); check(relative(folder, path) === file.name, 'INVALID_PATH', 'A managed file left its export directory.'); await unlink(path); removed.push(`${name}/${file.name}`); }
    }
    return removed;
  }

export function custodyHost(internals: EngineInternals): { files: CustodyFiles; keys: DeviceKeyStore; autoBackups: boolean; clock: () => number; } | null {
    const option = internals.options.workspaceCustody; if (!option) return null;
    if (!internals.privateCustody) {
      const keys = option.deviceKeys === 'os' ? osDeviceKeyStore() : option.deviceKeys === 'none' ? noDeviceKeyStore('not-configured') : option.deviceKeys;
      internals.privateCustody = { files: internals.custodyFiles(), keys, autoBackups: option.autoBackups === true, clock: option.clock ?? Date.now };
    }
    return internals.privateCustody;
  }

export function custodyFiles(internals: EngineInternals): CustodyFiles { return internals.privateCustodyFiles ??= new CustodyFiles(internals.options.directory); }

export function custodyNow(internals: EngineInternals): number { return internals.custodyHost()?.clock() ?? Date.now(); }

export function storageKind(internals: EngineInternals): 'experimental-file' | 'postgres' {
    return internals.vault?.storageKind ?? (internals.options.storage === 'experimental-file' && (internals.options.demo || internals.options.venture?.host === 'desktop') ? 'experimental-file' : 'postgres');
  }

export function custodySerial<T>(internals: EngineInternals, work: () => Promise<T>): Promise<T> {
    const next = internals.privateCustodyChain.then(work); internals.privateCustodyChain = next.catch(() => {}); return next;
  }

export function resetCustodySession(internals: EngineInternals): void {
    internals.privateOpenFolder = null; internals.privateOpenUnlock = null;
    internals.privateSchedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    internals.privateSnapshotMark = { at: null, revision: null };
    // C5 task 24: an unfinished Google sign-in closes with the business.
    internals.privateDrive?.client.close(); internals.privateDrive = null;
  }

export function snapshotStore(internals: EngineInternals): WorkspaceSnapshots | null {
    if (internals.options.venture?.host === 'hosted-web') return null;
    const custody = internals.custodyHost(); if (!custody) return null;
    return internals.privateSnapshots ??= new WorkspaceSnapshots(internals.options.directory, () => custody.keys);
  }

export async function snapshotReads(internals: EngineInternals): Promise<BusinessSnapshotRead[]> {
    const store = internals.snapshotStore(); if (!store) return [];
    try {
      const files = internals.custodyFiles();
      const listed = (await files.listBusinesses(internals.storageKind())).businesses;
      const vaults = new Map((await files.listCards()).map(card => [card.folder, card.vaultId]));
      return await store.list(listed.map(item => ({ id: item.folder, name: item.name, opens: item.opens, openedAt: item.openedAt })), vaults, internals.vault ? internals.privateOpenFolder : null);
    } catch { return []; }
  }

export async function neverContactReset(internals: EngineInternals, payload: any): Promise<{ line: string }> {
    const store = internals.snapshotStore(), vault = internals.store();
    check(store, 'TIER_UNAVAILABLE', 'This computer keeps no never-contact list.');
    check(typeof payload?.confirmation === 'string' && payload.confirmation === vault.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.');
    let lost = false;
    try { await store.neverContactHas([]); } catch (error) { if ((error as ChausarError)?.code !== 'NEVER_CONTACT_LOST') throw error; lost = true; }
    check(lost, 'NEVER_CONTACT_OK', 'Your never-contact list on this computer still checks, so there is nothing to start again.');
    const line = await store.neverContactReset();
    await vault.update(state => audit(state, 'custody.never-contact-reset', {}));
    internals.privateSnapshotMark = { at: null, revision: null };
    await internals.writeSnapshot(false);
    return { line };
  }

export async function snapshotTick(internals: EngineInternals): Promise<void> {
    if (internals.privateClosing || internals.privateTransition || !internals.vault) return;
    internals.privateActiveRequests++;
    try { await internals.writeSnapshot(false); } finally { internals.privateActiveRequests--; internals.notifyIdle(); }
  }

export function snapshotWanted(internals: EngineInternals, lock: boolean): boolean {
    const store = internals.snapshotStore(), vault = internals.vault, folder = internals.privateOpenFolder;
    if (!store || !vault || !folder) return false;
    try {
      if (!vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return false;
      return snapshotDue(internals.privateSnapshotMark, vault.read().revision, internals.custodyNow(), lock);
    } catch { return false; }
  }

export async function writeSnapshot(internals: EngineInternals, lock: boolean): Promise<void> {
    const store = internals.snapshotStore(), vault = internals.vault, folder = internals.privateOpenFolder;
    if (!store || !vault || !folder) return;
    try {
      if (!internals.snapshotWanted(lock)) return;
      const host = await internals.privateVentureHost() as unknown as { snapshot?: (ctx: Context) => Promise<{ snapshot: Record<string, unknown>; neverContact: string[] } | null> };
      if (internals.vault !== vault || typeof host.snapshot !== 'function') return;
      const made = await host.snapshot({ ...internals.privateBaseContext });
      if (!made) return;
      internals.privateSnapshotMark = { at: internals.custodyNow(), revision: vault.read().revision };
      if (made.neverContact.length) await store.neverContactAdd(made.neverContact).catch(() => {});
      if (internals.privateOpenUnlock !== 'this-computer') { await store.remove(folder); return; }
      await store.write(folder, { format: SNAPSHOT_FORMAT, businessId: folder, vaultId: vault.vaultId, ...made.snapshot } as BusinessSnapshot);
    } catch { /* The next tick or lock tries again. */ }
  }

export function requireAppOwner(internals: EngineInternals, ctx: Context): void {
    internals.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Change how your business is kept from inside the app.');
  }

export async function computerSecret(internals: EngineInternals, vaultId: string | null): Promise<string> {
    const custody = internals.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const record = vaultId ? await custody.files.readKey(vaultId) : null;
    if (!record) throw new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
    // A business already kept by this computer: no passphrase opens it, so never say "Chausar asks for a passphrase".
    const probe = await custody.keys.probe();
    if (!probe.available) throw probe.reason === 'not-configured' || probe.reason === 'platform' ? deviceKeyFailed(probe.reason)
      : Object.assign(new ChausarError('DEVICE_KEY_FAILED', CUSTODY_WORDS.lock.keyNotAnswering), { reason: probe.reason });
    let secret: Buffer | null;
    try { secret = await custody.keys.unprotect(record); } catch { throw deviceKeyFailed(); }
    if (!secret) throw deviceKeyFailed();
    try { return secret.toString('base64url'); } finally { secret.fill(0); }
  }

export async function existingComputerSecret(internals: EngineInternals, vaultId: string): Promise<string | null> {
    try { return await internals.computerSecret(vaultId); } catch { return null; }
  }

export async function storeComputerSecret(internals: EngineInternals, vault: Vault, secret: Buffer): Promise<void> {
    const custody = internals.custodyHost()!; let record: DeviceKeyRecord | null = null;
    try { record = await custody.keys.protect(vault.vaultId, secret); await custody.files.writeKey(record); }
    catch {
      if (record) await custody.keys.forget(record).catch(() => {});
      await vault.close().catch(() => {}); throw deviceKeyFailed();
    }
  }

export async function forgetKeyIfUnused(internals: EngineInternals, vaultId: string, folder: string | null): Promise<void> {
    const custody = internals.custodyHost(); if (!custody) return;
    const others = (await custody.files.listCards()).filter(card => card.vaultId === vaultId && card.folder !== folder && card.unlock === 'this-computer');
    if (others.length) return;
    const record = await custody.files.readKey(vaultId); if (!record) return;
    await custody.keys.forget(record).catch(() => {});
    await custody.files.removeKey(vaultId);
  }

export async function currentCard(internals: EngineInternals): Promise<VaultCard> {
    const custody = internals.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const card = internals.privateOpenFolder ? await custody.files.readCard(internals.privateOpenFolder) : null;
    check(card, 'VAULT_LOCKED', 'Open your business first.');
    return card;
  }

export async function afterOpen(internals: EngineInternals, folder: string, how: 'this-computer' | 'typed', options: { recovery?: RecoveryState; reseal?: boolean; created?: boolean } = {}): Promise<void> {
    internals.privateOpenFolder = folder; internals.privateOpenUnlock = how === 'this-computer' ? 'this-computer' : 'passphrase'; internals.privateClosedByOwner = false;
    const custody = internals.custodyHost(); if (!custody) return;
    await internals.noteLiveVersion(folder);
    await internals.loadSchedule();
    const vault = internals.store(), state = vault.read(), unlock = internals.privateOpenUnlock, prior = await custody.files.readCard(folder);
    const recovery: RecoveryState = options.recovery ?? (prior?.state === 'ready' ? prior.recovery : how === 'typed' ? 'made' : 'unknown');
    const reseal = !!options.reseal || (!!prior && prior.state === 'ready' && (prior.pending !== null || prior.unlock !== unlock));
    const card: VaultCard = { ...(prior ?? newCard({ folder, unlock, recovery })), vaultId: vault.vaultId, workspaceId: state.workspace.id,
      name: state.workspace.name, demo: state.workspace.demo, unlock, recovery, state: 'ready', pending: reseal ? 'reseal' : null,
      wrappersDigest: vault.wrappersDigest, openedAt: new Date(internals.custodyNow()).toISOString() };
    await custody.files.writeCard(card);
    if (reseal) await internals.resealManaged();
    if (how === 'typed') await internals.forgetKeyIfUnused(vault.vaultId, folder);
    if (how === 'typed') await internals.snapshotStore()?.remove(folder); // a passphrase business keeps no summary (4J6)
    if (reseal) await custody.files.writeCard({ ...card, pending: null });
  }

export async function noteLiveVersion(internals: EngineInternals, folder: string): Promise<void> {
    const files = internals.custodyFiles(), state = internals.store().read(), prior = (await files.readDataVersions()).live[folder];
    await files.noteDataVersion({ live: { folder, entry: { ...(prior?.version === state.schemaVersion ? prior : {}), version: state.schemaVersion, workspaceId: state.workspace.id } } });
  }

export async function loadSchedule(internals: EngineInternals): Promise<void> {
    internals.privateSchedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    const vault = internals.vault; if (!vault || !internals.custodyHost()) return;
    const files = internals.custodyFiles(), newest = (await files.backupFiles(vault.read().workspace.id))[0];
    if (!newest) return;
    const header = await files.backupHeader(newest.name);
    internals.privateSchedule = { ...internals.privateSchedule, lastAt: newest.at, lastRevision: header?.vaultId === vault.vaultId ? header.revision : null };
  }

export async function resealManaged(internals: EngineInternals): Promise<{ resealed: string[]; skipped: { path: string; reason: string; }[]; }> {
    const vault = internals.store(), files = internals.custodyFiles(), workspaceId = vault.read().workspace.id;
    if (internals.privateOpenUnlock !== 'passphrase' && (await files.listCards()).some(card => card.state === 'ready' && card.vaultId === vault.vaultId
      && card.folder !== internals.privateOpenFolder && card.unlock === 'passphrase')) return { resealed: [], skipped: [] };
    const paths = [...(await files.backupFiles(workspaceId)).map(file => join(files.backups, file.name)), ...await files.exportFiles(workspaceId)];
    return vault.resealBackups(paths);
  }

export async function backupView(internals: EngineInternals, name: string): Promise<BackupView> {
    const files = internals.custodyFiles(), cards = internals.custodyHost() ? await files.listCards() : [];
    const found = (await files.backupViews(internals.store().read().workspace.id, cards)).backups.find(view => view.file === name);
    check(found, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    return (await internals.labelledBackups([found]))[0]!;
  }

export async function writeBackup(internals: EngineInternals, kind: BackupKind): Promise<BackupView> {
    const vault = internals.store(), files = internals.custodyFiles(), workspaceId = vault.read().workspace.id, revision = vault.read().revision;
    const folder = await safeDirectory(files.backups, true);
    let at = internals.custodyNow(), name = backupName(workspaceId, at, kind);
    for (const taken = new Set((await readdir(folder)).map(item => item.toLowerCase())); taken.has(name.toLowerCase()); name = backupName(workspaceId, ++at, kind));
    await vault.backup(join(folder, name));
    await files.noteDataVersion({ file: { name, version: vault.read().schemaVersion } });
    internals.privateSchedule = { lastAt: at, lastRevision: revision, due: false, lastError: null };
    if (kind !== 'manual') {
      const { remove } = keepBackups(await files.backupFiles(workspaceId), internals.custodyNow());
      for (const old of remove) await files.removeBackup(old).catch(() => {});
    }
    if (kind === 'auto') await internals.copyBackupOut();
    return internals.backupView(name);
  }

export async function backupCopyTo(internals: EngineInternals, payload: any): Promise<{ copy: BackupCopyView | null }> {
    check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the folder in the app.');
    const card = await internals.currentCard(), files = internals.custodyFiles();
    if (payload.folder === null) { await files.writeCard({ ...card, copy: null }); return { copy: null }; }
    check(typeof payload.folder === 'string' && isAbsolute(payload.folder), 'INVALID_PATH', 'Pick the folder in the app.');
    const inside = relative(resolve(internals.options.directory), resolve(payload.folder));
    check(inside.startsWith('..') || isAbsolute(inside), 'INVALID_PATH', "Pick a folder outside Chausar's own folders.");
    await files.writeCard({ ...card, copy: { folder: resolve(payload.folder), lastFile: null, lastCopiedAt: null, problem: null } });
    await internals.copyBackupOut();
    return { copy: copyViewOf((await internals.currentCard()).copy) };
  }

export function driveOf(internals: EngineInternals): DriveBackup {
    const workspaceId = internals.store().read().workspace.id;
    if (internals.privateDrive?.workspaceId === workspaceId) return internals.privateDrive.client;
    internals.privateDrive?.client.close();
    const option = internals.options.drive, build = option ?? driveClientOfBuild(), port = internals.options.venture?.credentials;
    const tokens: DriveTokens = option?.tokens ?? {
      read: async () => (port ? port.get(workspaceId, 'backups:google-drive') : null),
      write: async (text: string) => { if (!port) throw new ChausarError('DRIVE_NOT_SET_UP', CUSTODY_WORDS.errors.DRIVE_NOT_SET_UP); await port.set(workspaceId, 'backups:google-drive', text); },
      remove: async () => { await port?.delete(workspaceId, 'backups:google-drive'); },
    };
    const client = new DriveBackup({ clientId: build.clientId, clientSecret: build.clientSecret ?? null, tokens, ...(option?.endpoints ? { endpoints: option.endpoints } : {}), ...(option?.chunkBytes ? { chunkBytes: option.chunkBytes } : {}) });
    internals.privateDrive = { workspaceId, client };
    return client;
  }

export async function driveStatus(internals: EngineInternals): Promise<DriveStatus> {
    const { state } = await internals.driveOf().status();
    const card = internals.custodyHost() && internals.privateOpenFolder ? await internals.custodyFiles().readCard(internals.privateOpenFolder) : null;
    return { state, lastCopiedAt: card?.drive?.lastCopiedAt ?? null, problem: card?.drive?.problem ?? null };
  }

export async function driveNote(internals: EngineInternals, note: NonNullable<VaultCard['drive']> | null): Promise<void> {
    const custody = internals.custodyHost(); if (!custody || !internals.privateOpenFolder) return;
    const card = await custody.files.readCard(internals.privateOpenFolder);
    if (card) await custody.files.writeCard({ ...card, drive: note });
  }

export async function driveBackupOut(internals: EngineInternals): Promise<void> {
    const custody = internals.custodyHost(), vault = internals.vault;
    if (!custody || !vault || !internals.privateOpenFolder) return;
    try {
      const drive = internals.driveOf();
      if ((await drive.status()).state !== 'connected') return;
      const card = await custody.files.readCard(internals.privateOpenFolder), workspaceId = vault.read().workspace.id;
      const newest = (await custody.files.backupFiles(workspaceId))[0];
      if (!card || !newest || (card.drive?.lastFile === newest.name && !card.drive.problem)) return;
      try {
        await drive.upload(newest.name, Buffer.from(await readBoundedText(custody.files.backupPath(newest.name))), workspaceId);
        await internals.driveNote({ lastFile: newest.name, lastCopiedAt: new Date(internals.custodyNow()).toISOString(), problem: null });
      } catch (error) {
        await internals.driveNote({ lastFile: card.drive?.lastFile ?? null, lastCopiedAt: card.drive?.lastCopiedAt ?? null, problem: error instanceof ChausarError ? error.message : "Google Drive didn't take the copy. Chausar tries again with the next backup." });
      }
    } catch { /* not set up, or nothing to do: Drive is a help, never a gate */ }
  }

export async function copyBackupOut(internals: EngineInternals): Promise<void> {
    const custody = internals.custodyHost(), vault = internals.vault;
    if (!custody || !vault || !internals.privateOpenFolder) return;
    try {
      const files = custody.files, card = await files.readCard(internals.privateOpenFolder), copy = card?.copy;
      if (!card || !copy) return;
      const workspaceId = vault.read().workspace.id, newest = (await files.backupFiles(workspaceId))[0];
      if (!newest || (copy.lastFile === newest.name && !copy.problem)) return;
      let next = copy;
      try {
        await files.copyBackupOut(newest.name, copy.folder, workspaceId);
        next = { ...copy, lastFile: newest.name, lastCopiedAt: new Date(internals.custodyNow()).toISOString(), problem: null };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        const words = code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENODEV' ? CUSTODY_WORDS.copy.missing
          : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? CUSTODY_WORDS.copy.denied
            : code === 'ENOSPC' || code === 'EDQUOT' ? CUSTODY_WORDS.copy.full : CUSTODY_WORDS.copy.failed;
        next = { ...copy, problem: words };
      }
      await files.writeCard({ ...card, copy: next });
    } catch { /* the copy is a help, never a gate: the next tick tries again */ }
  }

export async function safetyBackup(internals: EngineInternals, required = false): Promise<BackupView | null> {
    try { return await internals.writeBackup('safety'); }
    catch (error) {
      internals.privateSchedule.lastError = (error as Error).message.slice(0, 300);
      if (required) throw new ChausarError('SAFETY_BACKUP_FAILED', CUSTODY_WORDS.lock.safetyBackupFailed);
      return null;
    }
  }

export async function undoLockChange(internals: EngineInternals, card: VaultCard, secret: string | null, made: DeviceKeyRecord | null): Promise<void> {
    const custody = internals.custodyHost(), vault = internals.vault; if (!custody || !vault || !secret) return;
    try {
      await vault.rewrapPassphrase(secret);
      await custody.files.writeCard({ ...card, pending: null, wrappersDigest: vault.wrappersDigest });
    } catch { return; }
    internals.privateOpenUnlock = card.unlock;
    if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); }
    // The undo made a new wrapper (a new salt), so bring the backups to it again.
    await internals.resealManaged().catch(() => {});
  }

export async function backupTick(internals: EngineInternals): Promise<void> {
    const custody = internals.custodyHost();
    if (!custody?.autoBackups || internals.privateClosing || internals.privateTransition || !internals.vault) return;
    internals.privateActiveRequests++;
    try {
      await internals.custodySerial(async () => {
        if (!internals.vault || !backupDue(internals.privateSchedule, internals.vault.read().revision, custody.clock())) return;
        try { await internals.writeBackup('auto'); }
        catch (error) { internals.privateSchedule.lastError = (error as Error).message.slice(0, 300); }
      });
      // C5 task 23: a copy that couldn't reach its folder goes when it can.
      await internals.custodySerial(() => internals.copyBackupOut());
      // C5 task 24: and the newest to Google Drive, once it is connected.
      await internals.custodySerial(() => internals.driveBackupOut());
    } finally { internals.privateActiveRequests--; internals.notifyIdle(); }
  }

export async function closingBackup(internals: EngineInternals): Promise<void> {
    const custody = internals.custodyHost();
    if (!custody?.autoBackups || !internals.vault || internals.privateSchedule.lastRevision === internals.vault.read().revision) return;
    await internals.custodySerial(async () => {
      try { if (internals.vault) await internals.writeBackup('auto'); }
      catch (error) { internals.privateSchedule.lastError = (error as Error).message.slice(0, 300); }
    }).catch(() => {});
  }

export async function custodyView(internals: EngineInternals): Promise<CustodyView> {
    const custody = internals.custodyHost();
    const probe: ProbeResult = custody ? await custody.keys.probe() : { available: false, reason: 'not-configured' };
    const computer = computerView(custody?.keys.scheme ?? null, probe, probe.available);
    if (!internals.vault) return { computer, business: null };
    const vault = internals.vault, files = internals.custodyFiles(), card = custody && internals.privateOpenFolder ? await files.readCard(internals.privateOpenFolder) : null;
    const backups = await files.backupFiles(vault.read().workspace.id), next = custody?.autoBackups ? nextBackupAt(internals.privateSchedule, vault.read().revision, internals.custodyNow()) : null;
    return { computer, business: { folder: internals.privateOpenFolder ?? '', unlock: internals.privateOpenUnlock ?? 'passphrase', recovery: card?.recovery ?? 'unknown', storage: vault.storageKind,
      backups: { auto: !!custody?.autoBackups, count: backups.length, newestAt: backups[0] ? new Date(backups[0].at).toISOString() : null,
        nextDueAt: next === null ? null : new Date(next).toISOString(), lastError: internals.privateSchedule.lastError, copy: copyViewOf(card?.copy) },
      // C4 task 36: the name the save dialog offers, by the day on this computer's own clock and zone.
      exportName: exportFileName(vault.read().workspace.name, new Date(internals.custodyNow()), Intl.DateTimeFormat().resolvedOptions().timeZone, false),
      // C4 task 37 (210.x2): the copies in Chausar's own exports folder, which Delete keeps.
      exportsHere: (await internals.managedExports()).length,
      // C4 task 38 (219.x1): the newest move file made, until the owner dismisses it.
      moveMadeAt: moveMadeOf(vault.read().activity),
      storeBytes: vault.storeBytes(), storeLimit: STORE_LIMIT_BYTES } };
  }

export async function backupList(internals: EngineInternals): Promise<{ backups: BackupView[]; more: boolean; }> {
    const files = internals.custodyFiles(), cards = await files.listCards();
    const listed = await files.backupViews(internals.vault ? internals.vault.read().workspace.id : null, cards);
    return internals.vault ? { ...listed, backups: await internals.labelledBackups(listed.backups) } : listed;
  }

export async function labelledBackups(internals: EngineInternals, backups: BackupView[]): Promise<BackupView[]> {
    if (!internals.vault || !backups.length) return backups;
    try {
      // A label holds business words, and this list is answered before the vault check: the owner, in the app, only.
      internals.requireAppOwner(internals.context);
      const { backupLabels } = await import('../venture/journal/backup-labels.ts');
      const labels = backupLabels(internals.vault.read(), backups.map(backup => backup.at), internals.context.memberId);
      return backups.map((backup, index) => (labels[index] ? { ...backup, after: labels[index]! } : backup));
    } catch { return backups; }
  }

export async function passphraseOn(internals: EngineInternals, payload: any): Promise<{ custody: CustodyView; recoveryCode: string | null; }> {
    const vault = internals.store(), card = await internals.currentCard();
    check(card.unlock === 'this-computer', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const files = internals.custodyFiles();
    await internals.safetyBackup(card.recovery !== 'made');
    // The secret it opens with now, to put things back if a step below fails.
    const before = await internals.existingComputerSecret(vault.vaultId);
    // The marker goes on the card before the rewrap, so a crash after it still finds the way in (workspace.open).
    await files.writeCard({ ...card, pending: 'to-passphrase' });
    let recoveryCode: string | null = null, next: VaultCard;
    try {
      await vault.rewrapPassphrase(payload.passphrase);
      // A passphrase can be forgotten and nobody can reset it, so the owner always leaves holding a recovery code.
      recoveryCode = card.recovery === 'made' ? null : await vault.rewrapRecovery();
      next = { ...card, unlock: 'passphrase', recovery: 'made', pending: 'forget', wrappersDigest: vault.wrappersDigest };
      await files.writeCard(next);
    } catch (error) {
      // Even a failed rewrap may have reached the disk, so commit the old secret again either way.
      await internals.undoLockChange(card, before, null);
      throw error;
    }
    internals.privateOpenUnlock = 'passphrase';
    await internals.snapshotStore()?.remove(card.folder); // its summary goes at once: a passphrase business keeps none (4J6)
    await internals.resealManaged();
    await internals.forgetKeyIfUnused(vault.vaultId, card.folder);
    await files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-on', { recoveryMade: recoveryCode !== null }));
    return { custody: await internals.custodyView(), recoveryCode };
  }

export async function passphraseOff(internals: EngineInternals, payload: any): Promise<{ custody: CustodyView; }> {
    const custody = internals.custodyHost()!, vault = internals.store(), card = await internals.currentCard();
    check(card.unlock === 'passphrase', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    // Other devices pull with the passphrase; a secret only this computer holds would shut them out of new revisions.
    check(!(internals.services.sync?.status(internals.context).enabled), 'SYNC_NEEDS_PASSPHRASE', CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
    check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    let secret = await internals.existingComputerSecret(vault.vaultId), made: DeviceKeyRecord | null = null;
    if (!secret) {
      const bytes = randomBytes(32);
      try { made = await custody.keys.protect(vault.vaultId, bytes); await custody.files.writeKey(made); secret = bytes.toString('base64url'); }
      catch (error) { if (made) await custody.keys.forget(made).catch(() => {}); throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed(); }
      finally { bytes.fill(0); }
    }
    try { await internals.safetyBackup(card.recovery !== 'made'); }
    catch (error) { if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); } throw error; }
    // The marker goes on the card before the rewrap; the key record stays until the change is settled either way.
    await custody.files.writeCard({ ...card, pending: 'to-this-computer' });
    let next: VaultCard;
    try {
      await vault.rewrapPassphrase(secret);
      next = { ...card, unlock: 'this-computer', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
      await custody.files.writeCard(next);
    } catch (error) {
      // The typed passphrase was just checked, so it puts the vault back; then the new key record goes.
      await internals.undoLockChange(card, payload.passphrase, made);
      throw error;
    }
    internals.privateOpenUnlock = 'this-computer';
    await internals.resealManaged();
    await custody.files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-off', {}));
    return { custody: await internals.custodyView() };
  }

export async function makeRecoveryCode(internals: EngineInternals, payload: any): Promise<{ custody: CustodyView; recoveryCode: string; }> {
    const vault = internals.store(), card = await internals.currentCard();
    if (card.unlock === 'passphrase') check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const recoveryCode = await vault.rewrapRecovery();
    const next: VaultCard = { ...card, recovery: 'made', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
    await internals.custodyFiles().writeCard(next);
    await internals.resealManaged();
    await internals.custodyFiles().writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.recovery-made', {}));
    return { custody: await internals.custodyView(), recoveryCode };
  }

export async function inspectManagedBackup(internals: EngineInternals, payload: any): Promise<BackupInspectView> {
    const vault = internals.store(), files = internals.custodyFiles(), workspaceId = vault.read().workspace.id;
    const parsed = typeof payload.file === 'string' ? parseBackupName(payload.file) : null;
    check(parsed, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(parsed.workspaceId === workspaceId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const header = await files.backupHeader(parsed.name);
    check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(header.vaultId === vault.vaultId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const view = await internals.backupView(parsed.name);
    const then = await vault.readBackupState(files.backupPath(parsed.name));
    const { backupCounts, backupDiff } = await import('../venture/views/backup-diff.ts');
    return { file: view.file, at: view.at, counts: backupCounts(then), since: backupDiff(vault.read(), then) };
  }

export async function restoreManagedBackup(internals: EngineInternals, payload: any): Promise<{ workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string; }; restoredFrom: BackupView; safety: BackupView; }> {
    check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the restore in the app.');
    const vault = internals.store(), files = internals.custodyFiles(), workspaceId = vault.read().workspace.id;
    const parsed = typeof payload.file === 'string' ? parseBackupName(payload.file) : null;
    check(parsed, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(parsed.workspaceId === workspaceId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const header = await files.backupHeader(parsed.name);
    check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(header.vaultId === vault.vaultId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const restoredFrom = await internals.backupView(parsed.name);
    // The safety copy is required here: the business's current state is about to be replaced.
    const safety = await internals.writeBackup('safety');
    await vault.replaceFromBackup(files.backupPath(parsed.name));
    await internals.attachSafely(vault);
    await vault.update(state => audit(state, 'backup.restored', { file: parsed.name, revision: header.revision }));
    return { workspace: internals.store().read().workspace, restoredFrom, safety };
  }

export async function transferExport(internals: EngineInternals, payload: any): Promise<{ dismissed: boolean; fileName?: undefined; text?: undefined; transferCode?: undefined; bytes?: undefined; } | { fileName: string; text: string; transferCode: string; bytes: number; dismissed?: undefined; }> {
    // C4 task 38 (219.x1): the owner takes away the "Move file made" line; nothing else changes.
    if (payload && Object.hasOwn(payload, 'dismiss')) {
      check(payload.dismiss === true && Object.keys(payload).length === 1, 'INVALID_REQUEST', 'Send dismiss: true to take the line away.');
      await internals.store().update(state => audit(state, 'custody.transfer-dismissed', {}));
      return { dismissed: true };
    }
    const vault = internals.store(), card = internals.custodyHost() && internals.privateOpenFolder ? await internals.custodyFiles().readCard(internals.privateOpenFolder) : null;
    if ((card?.unlock ?? internals.privateOpenUnlock ?? 'passphrase') === 'passphrase')
      check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const transferCode = makeTransferCode(), madeAt = new Date(internals.custodyNow()).toISOString();
    const text = await vault.transferText(transferCode, { recovery: (card ? card.recovery === 'made' : true) ? 'made' : 'not-made', madeAt });
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    await vault.update(state => audit(state, 'custody.transfer-exported', {}));
    return { fileName: moveFileName(new Date(madeAt)), text, transferCode, bytes: Buffer.byteLength(text) };
  }

export async function transferPeek(internals: EngineInternals, payload: any): Promise<{ name: string; movedOutAt: string | null; }> {
    check(payload && typeof payload === 'object' && Object.keys(payload).every(key => key === 'fileText' || key === 'transferCode'), 'INVALID_REQUEST', 'Send the move file and its code.');
    const text = payload.fileText;
    check(typeof text === 'string', 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'), 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    const code = normalizeTransferCode(payload.transferCode);
    check(code, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    const seen = await Vault.peekTransfer(text, code);
    check(seen, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    return { name: seen.name, movedOutAt: seen.madeAt };
  }

export async function transferImport(internals: EngineInternals, payload: any): Promise<{ workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string; }; folder: string; unlock: string; }> {
    check(!internals.vault, 'VAULT_OPEN', 'Lock the current workspace first.');
    internals.privateDraft?.clear();
    const text = payload.fileText;
    check(typeof text === 'string', 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0 && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'),
      'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    const files = internals.custodyFiles();
    check(!(await files.vaultIds()).has(envelope.id), 'TRANSFER_SAME_BUSINESS', CUSTODY_WORDS.errors.TRANSFER_SAME_BUSINESS);
    const code = normalizeTransferCode(payload.transferCode);
    check(code, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    const custody = internals.custodyHost(), computer = payload.passphrase === undefined || payload.passphrase === null;
    if (computer) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    } else check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const folder = nextFolder(`moved-${randomBytes(3).toString('hex')}`, await files.takenFolders());
    const path = await files.transferFile(text);
    try {
      let vault: Vault;
      // Review of A1 (row 8): the step a failed move stopped at goes to the custody diagnostic log, with the error's code.
      const note = (step: string, error: unknown) => files.noteDiagnostic('transfer.import', step, error, new Date(internals.custodyNow()).toISOString());
      try { vault = await Vault.restore({ directory: internals.workspacePath(folder), backupFile: path, passphrase: code, storage: await internals.adapter(folder), writerGuard: internals.writerGuard(), kdfMemo: internals.options.kdfMemo }); }
      catch (error) {
        if ((error as ChausarError).code === 'UNLOCK_FAILED') throw new ChausarError('TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
        await note('restore', error); throw error;
      }
      let record: DeviceKeyRecord | null = null;
      const secret = computer ? randomBytes(32) : null;
      let step = 'protect';
      try {
        // One-shot A1 (row 8): a key this computer could not keep offers the passphrase instead (DEVICE_KEYS_UNAVAILABLE,
        // which the move screen answers with a passphrase), never "this computer's key didn't open your business".
        if (secret) {
          try { record = await custody!.keys.protect(vault.vaultId, secret); }
          catch (error) {
            const reason = (error as { reason?: unknown }).reason;
            throw deviceKeysUnavailable(typeof reason === 'string' && Object.hasOwn(CUSTODY_WORDS.unavailable, reason) ? reason as keyof typeof CUSTODY_WORDS.unavailable : 'failed');
          }
          step = 'write-key'; await files.writeKey(record);
          step = 'rewrap'; await vault.rewrapPassphrase(secret.toString('base64url'));
        }
        else { step = 'rewrap'; await vault.rewrapPassphrase(payload.passphrase); }
        // The card goes down before attaching, so if attaching fails the list still shows the right way in.
        step = 'write-card';
        const state = vault.read();
        await files.writeCard(newCard({ folder, vaultId: vault.vaultId, workspaceId: state.workspace.id, name: state.workspace.name, demo: state.workspace.demo,
          unlock: computer ? 'this-computer' : 'passphrase', recovery: transferHint(parsed), wrappersDigest: vault.wrappersDigest }));
      } catch (error) {
        await note(step, error);
        await files.removeCard(folder).catch(() => {});
        await vault.delete().catch(() => {});
        if (record) { await custody!.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
        // Anything else that stopped the move (a file Chausar could not write) says so in plain words; nothing was kept.
        throw error instanceof ChausarError ? error : new ChausarError('TRANSFER_FAILED', CUSTODY_WORDS.errors.TRANSFER_FAILED);
      } finally { secret?.fill(0); }
      await internals.attachSafely(vault);
    } finally { await files.removeTransfer(path).catch(() => {}); }
    await internals.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: transferHint(parsed) });
    return { workspace: internals.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase' };
  }

export async function importCopy(internals: EngineInternals, payload: any): Promise<CopyImportResult> {
    check(typeof payload.file === 'string' && isAbsolute(payload.file), 'INVALID_PATH', 'Choose the copy in the app.');
    const errors = CUSTODY_WORDS.errors;
    let parsed: any = null;
    try { parsed = JSON.parse(await readBoundedText(payload.file)); } catch { parsed = null; }
    if (parsed && parsed.backupFormat === undefined && parsed.workspace && Number.isSafeInteger(parsed.revision)) throw new ChausarError('IMPORT_READABLE', errors.IMPORT_READABLE);
    if (payload.file.toLowerCase().endsWith('.json') && parsed?.backupFormat === undefined) throw new ChausarError('IMPORT_READABLE', errors.IMPORT_READABLE);
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'), 'IMPORT_INVALID', errors.IMPORT_INVALID);
    const files = internals.custodyFiles(), id: string = envelope.id;
    if (internals.vault) {
      internals.requireAppOwner(internals.context);
      check(internals.vault.vaultId === id, 'IMPORT_CLOSE_FIRST', errors.IMPORT_CLOSE_FIRST);
      check(payload.restore === true, 'IMPORT_ALREADY_HERE', errors.IMPORT_ALREADY_HERE);
      return internals.custodySerial(() => internals.restoreFromCopy(payload.file));
    }
    internals.privateDraft?.clear();
    if ((await files.vaultIds()).has(id)) {
      check(payload.restore === true, 'IMPORT_ALREADY_HERE', errors.IMPORT_ALREADY_HERE);
      const card = (await files.listCards()).find(item => item.vaultId === id && item.state === 'ready');
      await internals.handleRequest('workspace.open', { folder: card?.folder ?? 'main', ...(typeof payload.passphrase === 'string' ? { passphrase: payload.passphrase } : {}) });
      return internals.custodySerial(() => internals.restoreFromCopy(payload.file));
    }
    const recoveryCode = typeof payload.recoveryCode === 'string' && payload.recoveryCode ? payload.recoveryCode : undefined;
    const typed = typeof payload.passphrase === 'string' && payload.passphrase ? payload.passphrase as string : undefined;
    check(recoveryCode !== undefined || typed !== undefined, 'PASSPHRASE_REQUIRED', errors.IMPORT_NEEDS_SECRET);
    const custody = internals.custodyHost();
    const folder = nextFolder(`copy-${randomBytes(3).toString('hex')}`, await files.takenFolders());
    internals.workspacePath(folder);
    let how: 'this-computer' | 'typed' = 'typed', fresh: Buffer | null = null, credentials: { passphrase: string } | { recoveryCode: string; newPassphrase: string };
    if (recoveryCode !== undefined && typed !== undefined) credentials = { recoveryCode, newPassphrase: typed };
    else if (recoveryCode !== undefined) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      fresh = randomBytes(32); how = 'this-computer';
      credentials = { recoveryCode, newPassphrase: fresh.toString('base64url') };
    } else credentials = { passphrase: typed! };
    try {
      const vault = await Vault.restore({ directory: internals.workspacePath(folder), backupFile: payload.file, ...credentials, storage: await internals.adapter(folder), writerGuard: internals.writerGuard(), kdfMemo: internals.options.kdfMemo });
      if (fresh) await internals.storeComputerSecret(vault, fresh);
      await internals.attachSafely(vault);
    } catch (error) {
      await internals.removeEmptyFolder(internals.workspacePath(folder));
      throw error;
    } finally { fresh?.fill(0); }
    await internals.afterOpen(folder, how, { recovery: recoveryCode !== undefined ? 'made' : 'unknown', reseal: recoveryCode !== undefined });
    return { workspace: internals.store().read().workspace, folder, unlock: how === 'typed' ? 'passphrase' : 'this-computer' };
  }

export async function restoreFromCopy(internals: EngineInternals, file: string): Promise<CopyImportResult> {
    const vault = internals.store();
    await internals.writeBackup('safety');
    await vault.replaceFromBackup(file);
    await internals.attachSafely(vault);
    await vault.update(state => audit(state, 'backup.restored', { file: 'exported-copy', revision: vault.read().revision }));
    return { workspace: internals.store().read().workspace, folder: internals.privateOpenFolder ?? '', unlock: internals.privateOpenUnlock ?? 'passphrase', restored: true };
  }

export async function removeEmptyFolder(internals: EngineInternals, path: string): Promise<void> {
    try { await rmdir(path); } catch { /* not empty, or already gone */ }
  }

export async function forgetBusiness(internals: EngineInternals, folder: string | null, vaultId: string): Promise<void> {
    const custody = internals.custodyHost(); if (!custody || !folder) return;
    await custody.files.removeCard(folder);
    await internals.snapshotStore()?.remove(folder); // its summary goes with it (4J6)
    if (!(await custody.files.listCards()).some(card => card.vaultId === vaultId)) {
      const record = await custody.files.readKey(vaultId);
      if (record) { await custody.keys.forget(record).catch(() => {}); await custody.files.removeKey(vaultId); }
    }
  }

export function requireWorkspaceOwner(internals: EngineInternals, ctx: Context): void { const member = authorize(internals.store(), ctx, 'admin'); check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only the business\'s owner can copy or delete the whole business.'); }
