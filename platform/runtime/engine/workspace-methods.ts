import { markNewCaptureSample } from '../venture/replay/sample.ts';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Vault } from '../vault.ts';
import { OntologyService } from '../ontology.ts';
import { seedDemo } from '../ingest.ts';
import { authorize, check, ChausarError, now } from '../contracts.ts';
import { deviceKeyFailed, deviceKeysUnavailable, type DeviceKeyRecord } from '../device-custody.ts';
import { newCard, nextFolder, slugFolder } from '../workspace-custody.ts';
import { forgetAiSetup } from '../venture/models/ai-setup-file.ts';
import { CUSTODY_WORDS } from '../workspace-custody-contracts.ts';
import { withVault, type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = {
  "workspace.status": async (internals, payload) => {
    return {
      open: !!internals.vault, workspace: internals.vault?.read().workspace, storage: internals.options.storage, experimental: !!internals.options.demo, version: internals.version,
      ...(internals.options.workspaceCustody ? { ...(internals.vault && internals.privateOpenUnlock ? { unlock: internals.privateOpenUnlock } : {}), closedByOwner: internals.privateClosedByOwner } : {})
    };
  },
  "workspace.list": async (internals, payload) => {
    return internals.custodyFiles().listBusinesses(internals.storageKind());
  },
  "workspace.import": async (internals, payload) => {
    return internals.importCopy(payload);
  },
  "workspace.create": async (internals, payload) => {
    check(internals.options.sync === undefined, 'SYNC_EXISTING_WORKSPACE_REQUIRED', 'Create a local workspace before enrolling its exact identity in device sync.');
    check(!internals.vault, 'VAULT_OPEN', 'Lock the current workspace before creating another.');
    check(typeof payload.name === 'string' && payload.name.trim().length >= 2 && payload.name.length <= 100, 'INVALID_NAME', 'Give your business a name.');
    const pack = payload.pack ?? 'ecommerce'; check(new OntologyService({ read: () => { throw new Error('No vault'); }, update: async () => { throw new Error('No vault'); } }).packs().some(p => p.pack === pack), 'UNKNOWN_PACK', 'Choose an available business starter pack.');
    const custody = internals.custodyHost(), files = internals.custodyFiles(), name = payload.name.trim();
    // No passphrase: this computer keeps a random secret in the passphrase slot (KEYCHAIN-SPEC 2.1, 2.9).
    const computer = payload.passphrase === undefined || payload.passphrase === null;
    if (computer) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    }
    const taken = payload.folder === null ? await files.takenFolders() : null;
    let folder: string = taken ? slugFolder(name, taken) : payload.folder ?? 'main';
    internals.workspacePath(folder);
    let wroteCard = false, record: DeviceKeyRecord | null = null;
    const secret = computer ? randomBytes(32) : null;
    try {
      let result!: Awaited<ReturnType<typeof Vault.create>>;
      for (; ;) {
        if (custody && !(await files.readCard(folder))) {
          await files.writeCard(newCard({ folder, name, demo: !!payload.demo, unlock: computer ? 'this-computer' : 'passphrase', recovery: computer ? 'not-made' : 'made', state: 'creating' }));
          wroteCard = true;
        }
        try { result = await Vault.create({ directory: internals.workspacePath(folder), passphrase: secret ? secret.toString('base64url') : payload.passphrase, name, demo: !!payload.demo, storage: await internals.adapter(folder), kdfMemo: internals.options.kdfMemo }); break; }
        catch (error) {
          // The engine picked the folder, and an old vault with no card holds that slot (PostgreSQL storage
          // keeps no folder to find): take the next name instead. slugFolder stops after -99.
          if (!taken || (error as ChausarError).code !== 'VAULT_EXISTS') throw error;
          if (wroteCard) { await files.removeCard(folder).catch(() => { }); wroteCard = false; }
          taken.push(folder); folder = slugFolder(name, taken); internals.workspacePath(folder);
        }
      }
      if (custody && secret) {
        try { record = await custody.keys.protect(result.vault.vaultId, secret); await files.writeKey(record); }
        catch (error) {
          await result.vault.delete().catch(() => { });
          if (record) { await custody.keys.forget(record).catch(() => { }); await files.removeKey(record.vaultId).catch(() => { }); }
          throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed();
        }
      }
      try {
        if (internals.options.capture && internals.options.demo === true && payload.demo === true) markNewCaptureSample(result.vault);
        await internals.attach(result.vault); await internals.services.ontology.publish(internals.context, pack);
        if (payload.demo) await seedDemo(internals.store(), internals.context);
        internals.privateDraft?.hold();
        await internals.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: computer ? 'not-made' : 'made', created: true });
        wroteCard = false;
        const recoveryCode = computer ? null : result.recoveryCode;
        return { workspace: internals.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase', recoveryKit: recoveryCode, recoveryCode, experimental: !!internals.options.demo };
      } catch (error) {
        await result.vault.delete(); internals.vault = null; internals.services = {}; internals.resetCustodySession();
        if (record && custody) { await custody.keys.forget(record).catch(() => { }); await files.removeKey(record.vaultId).catch(() => { }); }
        throw error;
      }
    } catch (error) {
      if (wroteCard) await files.removeCard(folder).catch(() => { });
      throw error;
    } finally { secret?.fill(0); }
  },
  "workspace.open": async (internals, payload) => {
    check(!internals.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); internals.privateDraft?.clear();
    const folder = payload.folder ?? payload.path ?? 'main'; internals.workspacePath(folder);
    const custody = internals.custodyHost(), typed = payload.passphrase !== undefined && payload.passphrase !== null;
    const files = internals.custodyFiles(), card = custody ? await files.readCard(folder) : null;
    const unlockWith = async (passphrase: string) => Vault.open({ directory: internals.workspacePath(folder), passphrase, storage: await internals.adapter(folder), writerGuard: internals.writerGuard(), kdfMemo: internals.options.kdfMemo });
    const unlockFailed = (error: unknown) => (error as ChausarError)?.code === 'UNLOCK_FAILED';
    const passphraseRequired = () => new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
    // A lock change cut short (KEYCHAIN-SPEC 3.1, 3.2) leaves its marker on the card: the vault may already open the new way.
    const changing = card?.pending === 'to-passphrase' || card?.pending === 'to-this-computer';
    let vault: Vault, how: 'this-computer' | 'typed';
    if (!custody || typed) {
      try { vault = await unlockWith(payload.passphrase); how = 'typed'; }
      catch (error) {
        const secret = custody && changing && unlockFailed(error) && card?.vaultId ? await internals.existingComputerSecret(card.vaultId) : null;
        if (!secret) throw error;
        try { vault = await unlockWith(secret); how = 'this-computer'; } catch { throw error; }
      }
    } else if (card?.unlock === 'passphrase') {
      // Try this computer's key only when the change to it was cut short, or a key record for the vault is on disk.
      const record = card.vaultId ? await files.readKey(card.vaultId) : null;
      const secret = card.vaultId && (card.pending === 'to-this-computer' || record) ? await internals.existingComputerSecret(card.vaultId) : null;
      if (!secret) throw passphraseRequired();
      try { vault = await unlockWith(secret); how = 'this-computer'; }
      catch (error) { if (unlockFailed(error)) throw passphraseRequired(); throw error; }
    } else {
      // No card and no envelope to read (PostgreSQL storage, or no such folder): it needs a passphrase.
      const secret = await internals.computerSecret(card?.vaultId ?? await files.folderVaultId(folder));
      try { vault = await unlockWith(secret); how = 'this-computer'; }
      catch (error) {
        // Turning the passphrase on was cut short after the rewrap: only the passphrase opens it now.
        if (unlockFailed(error)) throw card?.pending === 'to-passphrase' ? passphraseRequired() : deviceKeyFailed();
        throw error;
      }
    }
    await internals.attachSafely(vault);
    await internals.afterOpen(folder, how);
    return { workspace: internals.store().read().workspace };
  },
  "workspace.recover": async (internals, payload) => {
    check(!internals.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); internals.privateDraft?.clear();
    const folder = payload.folder ?? 'main'; internals.workspacePath(folder);
    const custody = internals.custodyHost(), computer = !!custody && (payload.passphrase === undefined || payload.passphrase === null);
    let newPassphrase = payload.passphrase, fresh: Buffer | null = null;
    if (computer) {
      const probe = await custody!.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      const files = internals.custodyFiles(), card = await files.readCard(folder);
      const vaultId = card?.vaultId ?? await files.folderVaultId(folder);
      // Another folder may already open this vault with this computer's key: keep its secret.
      newPassphrase = vaultId ? await internals.existingComputerSecret(vaultId) : null;
      if (!newPassphrase) { fresh = randomBytes(32); newPassphrase = fresh.toString('base64url'); }
    }
    try {
      let moved: { from: number; backup: string } | null = null;
      const vault = await Vault.recover({ migrationBackup: async (json, workspaceId, from) => { moved = { from, backup: await internals.migrationBackup(json, workspaceId, from) }; }, directory: internals.workspacePath(folder), recoveryCode: payload.recoveryCode, newPassphrase, storage: await internals.adapter(folder), writerGuard: internals.writerGuard(), kdfMemo: internals.options.kdfMemo });
      if (fresh) await internals.storeComputerSecret(vault, fresh);
      if (moved) await internals.noteMigrated(vault, (moved as { from: number }).from, vault.read().schemaVersion, (moved as { backup: string }).backup);
      await internals.attachSafely(vault);
    } finally { fresh?.fill(0); }
    await internals.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: 'made', reseal: true });
    return { workspace: internals.store().read().workspace };
  },
  "workspace.restore": async (internals, payload) => {
    check(!internals.vault, 'VAULT_OPEN', 'Lock the current workspace before restoring.');
    internals.privateDraft?.clear();
    check(typeof payload.backupFile === 'string', 'INVALID_PATH', 'Choose a backup from this app.');
    const backupRoot = resolve(internals.options.directory, 'backups'); const backupFile = resolve(backupRoot, payload.backupFile); const rel = relative(backupRoot, backupFile);
    check(!rel.startsWith('..') && !isAbsolute(rel) && rel.endsWith('.backup'), 'INVALID_PATH', 'Choose a managed backup file.');
    const custody = internals.custodyHost(), files = internals.custodyFiles();
    const header = custody && !rel.includes('/') && !rel.includes('\\') ? await files.backupHeader(rel) : null;
    const original = header ? (await files.listCards()).find(card => card.vaultId === header.vaultId && card.state === 'ready') ?? null : null;
    const folder = payload.folder === null ? nextFolder(`${original?.folder ?? 'restored'}${original ? '-restored' : ''}`.slice(0, 64), await files.takenFolders()) : payload.folder ?? 'restored';
    internals.workspacePath(folder);
    const recoveryCode = typeof payload.recoveryCode === 'string' ? payload.recoveryCode : undefined;
    const typed = payload.passphrase !== undefined && payload.passphrase !== null;
    let how: 'this-computer' | 'typed' = typed ? 'typed' : 'this-computer', fresh: Buffer | null = null, credentials: { passphrase: string } | { recoveryCode: string; newPassphrase: string };
    if (recoveryCode !== undefined && typed) credentials = { recoveryCode, newPassphrase: payload.passphrase };
    else if (recoveryCode !== undefined && custody) {
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      let secret = header ? await internals.existingComputerSecret(header.vaultId) : null;
      if (!secret) { fresh = randomBytes(32); secret = fresh.toString('base64url'); }
      credentials = { recoveryCode, newPassphrase: secret };
    } else if (!typed && custody) {
      check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
      credentials = { passphrase: (await internals.computerSecret(header.vaultId))! };
    } else { credentials = { passphrase: payload.passphrase }; how = 'typed'; }
    try {
      let vault: Vault;
      try { vault = await Vault.restore({ directory: internals.workspacePath(folder), backupFile, ...credentials, storage: await internals.adapter(folder), writerGuard: internals.writerGuard(), kdfMemo: internals.options.kdfMemo }); }
      catch (error) { if (custody && how === 'this-computer' && !('recoveryCode' in credentials) && (error as ChausarError).code === 'UNLOCK_FAILED') throw deviceKeyFailed(); throw error; }
      if (fresh) await internals.storeComputerSecret(vault, fresh);
      await internals.attachSafely(vault);
    } finally { fresh?.fill(0); }
    const rewrapped = 'recoveryCode' in credentials;
    await internals.afterOpen(folder, how, { recovery: rewrapped ? 'made' : original?.recovery ?? (how === 'typed' ? 'made' : 'unknown'), reseal: rewrapped });
    return { workspace: internals.store().read().workspace, folder };
  },
  "workspace.lock": async (internals, payload) => {
    if (internals.vault) { authorize(internals.vault, internals.context, 'admin'); await internals.closingBackup(); }
    await internals.closeVault(); internals.privateClosedByOwner = true; return { locked: true };
  },
  "workspace.backup": withVault(async (internals, payload, store, ctx, s) => {
    {
      internals.requireWorkspaceOwner(ctx); const folder = join(internals.options.directory, 'backups'); await mkdir(folder, { recursive: true });
      const path = join(folder, `chausar-${store.read().workspace.id}-${Date.now()}.backup`); await store.backup(path); return { path, encrypted: true };
    }
  }),
  "workspace.export": withVault(async (internals, payload, store, ctx, s) => {
    {
      internals.requireWorkspaceOwner(ctx); check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the export in the app.');
      const tail = payload.plaintext ? 'json' : 'vault';
      // C4 task 36 (206.x1): a path only the desktop's own save dialog chose (main.cjs, export-save.cjs; the window's
      // requests can't carry one): absolute, with the export's own extension. Without one, Chausar's exports folder.
      if (payload.path !== undefined) {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Export a copy from inside the app.');
        check(typeof payload.path === 'string' && isAbsolute(payload.path) && payload.path.length <= 1024 && payload.path.toLowerCase().endsWith(`.${tail}`), 'INVALID_PATH', 'Choose where to save the copy in the save dialog.');
        await store.export(payload.path, { plaintext: payload.plaintext === true });
        // C5 task 22: a readable copy notes itself, so Today can ask about it a day later; the path stays in the custody files.
        if (payload.plaintext === true) await internals.custodyFiles().noteReadable(`chausar-${store.read().workspace.id}-${Date.now()}.json`, new Date(internals.custodyNow()).toISOString(), payload.path).catch(() => { });
        return { path: payload.path, name: basename(payload.path), encrypted: payload.plaintext !== true };
      }
      const folder = join(internals.options.directory, 'exports'); await mkdir(folder, { recursive: true }); const path = join(folder, `chausar-${store.read().workspace.id}-${Date.now()}.${tail}`);
      await store.export(path, { plaintext: payload.plaintext === true });
      // C5 task 22: a readable copy notes itself, kind and time only, so Today can ask about it a day later.
      if (payload.plaintext === true) await internals.custodyFiles().noteReadable(basename(path), new Date(internals.custodyNow()).toISOString()).catch(() => { });
      return { path, name: basename(path), encrypted: payload.plaintext !== true };
    }
  }),
  "workspace.delete": withVault(async (internals, payload, store, ctx, s) => {
    {
      internals.requireWorkspaceOwner(ctx); check(payload.confirmation === store.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete it.');
      // One-shot A1 (row 1): its backups go; the copies the owner exported stay, and the answer names them.
      const removed = await internals.purgeManagedCopies(['backups']), exportsKept = await internals.managedExports();
      const deletedVault = store.vaultId, deletedFolder = internals.privateOpenFolder, deletedWorkspace = store.read().workspace.id, deletedName = store.read().workspace.name;
      await store.delete(); await internals.closeVault(); await internals.forgetBusiness(deletedFolder, deletedVault);
      // A4 review round 2 (M2): the AI setup it saved goes too, so no later business names it. Never fails the delete.
      const aiSetup = internals.privateAiSetup();
      if (aiSetup) await forgetAiSetup(aiSetup, deletedWorkspace).catch(() => { });
      // One-shot A4 (hands-on S10): the business's own folder goes too, only when nothing is left in it.
      await internals.removeEmptyFolder(internals.workspacePath(deletedFolder ?? undefined));
      // C4 task 37 (211.x1): the name and how many backups went, for Welcome's "Pune Frames is deleted. 7 backups removed."
      return { deleted: true, name: deletedName, backupsRemoved: removed.filter(path => path.startsWith('backups/')).length, copiesRemoved: removed, exportsKept, externalCopies: 'Copies made outside this app must be removed by their owner.' };
    }
  })
};
