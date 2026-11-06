// Files and pure rules for keeping a business on this computer (KEYCHAIN-SPEC 2.8, 4.2 to 4.6, 5.2, 8.3).
// Cards say which businesses live here; key records hold the OS's protected blob or a pointer to the OS item.
// No secret passes through this file except into a DeviceKeyStore.
import { randomBytes } from 'node:crypto';
import { appendFile, copyFile, lstat, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError, check, internalCheck } from './contracts.ts';
import { atomicWriteText, readBoundedText, safeDirectory, wrappersDigestOf } from './vault.ts';
import type { DeviceKeyRecord } from './device-custody.ts';
import { newerFormat, noteNewerOnce, readLocalJson } from './local-files.ts';
import {
  AUTO_BACKUP, BACKUP_LIST_MAX, BUSINESS_LIST_MAX, CUSTODY_WORDS, TRANSFER,
  type BackupKind, type BackupView, type BusinessList, type BusinessOnComputer, type ComputerCustodyView,
  type DeviceScheme, type DeviceUnavailableReason, type RecoveryState, type UnlockMode,
} from './workspace-custody-contracts.ts';

export const CARD_FORMAT = 'chausar.vault-card.v1';
export type VaultCard = {
  format: typeof CARD_FORMAT; folder: string; vaultId: string | null; workspaceId: string | null;
  /** The business name, readable on disk so Welcome back can list it before opening (K7). */
  name: string | null; demo: boolean | null;
  unlock: UnlockMode; recovery: RecoveryState; wrappersDigest: string | null;
  /** 'to-passphrase' and 'to-this-computer' are written before a lock change rewraps the vault. When one is still set,
   * the change was cut short, so opening tries both ways in and the next successful open clears it. */
  state: 'creating' | 'ready'; pending: CardPending;
  createdAt: string; openedAt: string | null;
  /** C5 task 23: where automatic backups are copied (ciphertext only), and how the last copy went. */
  copy?: BackupCopySetting | null;
  /** C5 task 24: how the last copy to Google Drive went. Never a token. */
  drive?: { lastFile: string | null; lastCopiedAt: string | null; problem: string | null } | null;
};
export type BackupCopySetting = { folder: string; lastFile: string | null; lastCopiedAt: string | null; problem: string | null };
/** C5 task 23: how many copies stay on the drive or folder. */
export const COPY_KEEP = 5;
/** C5 task 22: a readable export this computer knows of: kind and time only, never a business word. kept: the owner said to keep it. */
type ReadableNote = { file: string; at: string; kept: boolean; path?: string };
const READABLE_NAME = /^chausar-[A-Za-z0-9_-]{1,200}-\d{1,16}\.json$/;
export type CardPending = null | 'reseal' | 'forget' | 'to-passphrase' | 'to-this-computer';
export const CARD_PENDING: readonly CardPending[] = Object.freeze([null, 'reseal', 'forget', 'to-passphrase', 'to-this-computer']);
export const FOLDER_RULE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const VAULT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
/** Names beside the vault folders that are never a business. */
export const RESERVED_FOLDERS = Object.freeze(['backups', 'exports', 'updates', 'custody', 'transfers']);
export const isReservedFolder = (name: string) => name.startsWith('.') || RESERVED_FOLDERS.includes(name.toLowerCase());

// ---------------------------------------------------------------- folder names

/** slug(name): lower case, every run of other characters to one '-', trimmed, at most 48 characters; then -2 to -99. */
export function slugFolder(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(item => item.toLowerCase()));
  let base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  if (!FOLDER_RULE.test(base) || isReservedFolder(base)) base = 'business';
  const free = (folder: string) => !used.has(folder.toLowerCase()) && !isReservedFolder(folder);
  if (free(base)) return base;
  for (let n = 2; n <= 99; n++) { const folder = `${base}-${n}`; if (free(folder)) return folder; }
  throw new ChausarError('FOLDER_TAKEN', 'Too many businesses share this name on this computer. Choose another name.');
}
export function nextFolder(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(item => item.toLowerCase()));
  const free = (folder: string) => FOLDER_RULE.test(folder) && !used.has(folder.toLowerCase()) && !isReservedFolder(folder);
  if (free(base)) return base;
  for (let n = 2; n <= 99; n++) { const folder = `${base.slice(0, 60)}-${n}`; if (free(folder)) return folder; }
  throw new ChausarError('FOLDER_TAKEN', 'Too many folders share this name on this computer.');
}

// ---------------------------------------------------------------- cards and key records

export class CustodyFiles {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  get cards() { return join(this.directory, 'custody', 'cards'); }
  get keys() { return join(this.directory, 'custody', 'keys'); }
  get backups() { return join(this.directory, 'backups'); }
  get transfers() { return join(this.directory, 'transfers'); }
  async #folder(path: string, create: boolean): Promise<string | null> {
    try { return await safeDirectory(path, create); }
    catch (error: any) { if (!create && error?.code === 'ENOENT') return null; throw error; }
  }
  async #readJson(directory: string, name: string): Promise<any | null> {
    const folder = await this.#folder(directory, false); if (!folder) return null;
    try { return JSON.parse(await readBoundedText(join(folder, name))); }
    catch (error: any) { if (error?.code === 'ENOENT' || error?.message === 'Missing file') return null; throw error; }
  }
  async #write(directory: string, name: string, value: unknown) {
    const folder = await this.#folder(directory, true);
    await atomicWriteText(join(folder!, name), JSON.stringify(value), true);
  }
  async #remove(directory: string, name: string) {
    const folder = await this.#folder(directory, false); if (!folder) return;
    try { const info = await lstat(join(folder, name)); if (info.isFile() && !info.isSymbolicLink()) await unlink(join(folder, name)); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
  /** D12: a card a newer Chausar wrote is left alone (ignored, never rewritten or removed) and noted once. */
  async #newerCard(folder: string): Promise<boolean> {
    if (!newerFormat(await readLocalJson(join(this.cards, `${folder}.json`)), CARD_FORMAT)) return false;
    await noteNewerOnce(join(this.directory, 'custody'), `cards/${folder}.json`, 'card');
    return true;
  }
  async readCard(folder: string): Promise<VaultCard | null> {
    if (!FOLDER_RULE.test(folder)) return null;
    if (await this.#newerCard(folder)) return null;
    const card = await this.#readJson(this.cards, `${folder}.json`);
    return validCard(card) && card.folder === folder ? card : null;
  }
  /**
   * Review of A1 (row 8): one line in this computer's custody diagnostic log (custody/diagnostics.jsonl), so the next
   * failure on a real machine can be told apart. Only the operation, the step and the error's own code, system call and
   * reason go in, each a short plain tag: never a message, a path, a name, a code or a secret. Kept to the last 200 lines.
   * It never throws: a log that cannot be written changes nothing.
   */
  async noteDiagnostic(op: string, step: string, error: unknown, at: string): Promise<void> {
    try {
      const tag = (value: unknown) => (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : undefined);
      const raw = error as { code?: unknown; syscall?: unknown; reason?: unknown } | null;
      const entry = { at, op: tag(op), step: tag(step), code: tag(raw?.code) ?? (error instanceof Error ? tag(error.name) : undefined), syscall: tag(raw?.syscall), reason: tag(raw?.reason) };
      const folder = await this.#folder(join(this.directory, 'custody'), true);
      const path = join(folder!, 'diagnostics.jsonl');
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
      const lines = (await readBoundedText(path)).trim().split('\n');
      if (lines.length > 200) await atomicWriteText(path, `${lines.slice(-200).join('\n')}\n`, true);
    } catch { /* the log is a help, never a gate */ }
  }
  async writeCard(card: VaultCard) { check(validCard(card), 'INVALID_CARD', 'A business card needs its folder and unlock mode.'); if (await this.#newerCard(card.folder)) return; await this.#write(this.cards, `${card.folder}.json`, card); }
  async removeCard(folder: string) { if (FOLDER_RULE.test(folder) && !(await this.#newerCard(folder))) await this.#remove(this.cards, `${folder}.json`); }
  async listCards(): Promise<VaultCard[]> {
    const folder = await this.#folder(this.cards, false); if (!folder) return [];
    const cards: VaultCard[] = [];
    for (const name of (await readdir(folder)).sort()) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.json$/.test(name)) continue;
      try { const card = await this.readCard(name.slice(0, -5)); if (card) cards.push(card); } catch { /* an unreadable card is skipped, never trusted */ }
    }
    return cards;
  }
  async readKey(vaultId: string): Promise<DeviceKeyRecord | null> {
    if (!VAULT_ID.test(vaultId)) return null;
    const value = await this.#readJson(this.keys, `${vaultId}.json`);
    return value && value.format === 'chausar.device-key.v1' && value.vaultId === vaultId ? value : null;
  }
  async writeKey(record: DeviceKeyRecord) { internalCheck(VAULT_ID.test(record.vaultId), 'INVALID_KEY_RECORD', 'A key record needs its vault id.'); await this.#write(this.keys, `${record.vaultId}.json`, record); }
  async removeKey(vaultId: string) { if (VAULT_ID.test(vaultId)) await this.#remove(this.keys, `${vaultId}.json`); }
  /** The vault id of an old file-storage folder, read from its envelope header (public metadata). */
  async folderVaultId(folder: string): Promise<string | null> {
    if (!FOLDER_RULE.test(folder) || isReservedFolder(folder)) return null;
    try {
      const envelope = JSON.parse(await readBoundedText(join(this.directory, folder, 'authority.encrypted.json')));
      return typeof envelope?.id === 'string' && VAULT_ID.test(envelope.id) ? envelope.id : null;
    } catch { return null; }
  }
  /** Every name beside the vault folders, so a new folder never reuses one. */
  async takenFolders(): Promise<string[]> {
    const names: string[] = [];
    try { names.push(...await readdir(this.directory)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    names.push(...(await this.listCards()).map(card => card.folder));
    return names;
  }
  async #vaultFolders(): Promise<string[]> {
    let entries: string[];
    try { entries = (await readdir(this.directory)).sort(); } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
    const found: string[] = [];
    for (const name of entries) {
      if (!FOLDER_RULE.test(name) || isReservedFolder(name)) continue;
      try {
        const info = await lstat(join(this.directory, name));
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const file = await lstat(join(this.directory, name, 'authority.encrypted.json'));
        if (file.isFile() && !file.isSymbolicLink()) found.push(name);
      } catch { /* no envelope: not a file-storage vault */ }
    }
    return found;
  }
  /** Cards first (newest opened first), then old file-storage vault folders with no card yet. */
  async listBusinesses(storage: 'experimental-file' | 'postgres'): Promise<BusinessList> {
    const cards = await this.listCards();
    const rows: BusinessOnComputer[] = [];
    for (const card of cards) {
      if (card.state !== 'ready') continue;
      const key = !!card.vaultId && !!await this.readKey(card.vaultId);
      // A lock change cut short: list the way in it was moving to, since that is the likely one now (open tries both).
      let opens: BusinessOnComputer['opens'] = 'needs-passphrase';
      if (card.unlock === 'this-computer' && card.pending !== 'to-passphrase') opens = key ? 'with-this-computer' : 'key-missing';
      else if (card.unlock === 'passphrase' && card.pending === 'to-this-computer' && key) opens = 'with-this-computer';
      rows.push({ folder: card.folder, name: card.name, demo: card.demo, unlock: card.unlock, opens, recovery: card.recovery, openedAt: card.openedAt, listedFrom: 'card' });
    }
    rows.sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '') || a.folder.localeCompare(b.folder));
    const carded = new Set(cards.map(card => card.folder.toLowerCase()));
    if (storage === 'experimental-file') for (const folder of await this.#vaultFolders()) {
      if (carded.has(folder.toLowerCase())) continue;
      rows.push({ folder, name: null, demo: null, unlock: 'passphrase', opens: 'needs-passphrase', recovery: 'unknown', openedAt: null, listedFrom: 'folder' });
    }
    return { businesses: rows.slice(0, BUSINESS_LIST_MAX), complete: storage === 'experimental-file' && rows.length <= BUSINESS_LIST_MAX };
  }
  /** Vault ids already on this computer (cards, and old file-storage folders). */
  async vaultIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const card of await this.listCards()) if (card.vaultId) ids.add(card.vaultId);
    for (const folder of await this.#vaultFolders()) { const id = await this.folderVaultId(folder); if (id) ids.add(id); }
    return ids;
  }

  // -------------------------------------------------------------- backups

  async backupFiles(workspaceId: string | null): Promise<BackupFile[]> {
    const folder = await this.#folder(this.backups, false); if (!folder) return [];
    const found: BackupFile[] = [];
    for (const name of await readdir(folder)) {
      const parsed = parseBackupName(name); if (!parsed || (workspaceId !== null && parsed.workspaceId !== workspaceId)) continue;
      try { const info = await lstat(join(folder, name)); if (!info.isFile() || info.isSymbolicLink()) continue; found.push({ ...parsed, bytes: info.size }); }
      catch { /* removed while listing */ }
    }
    return found.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  }
  backupPath(name: string): string {
    check(parseBackupName(name), 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    return join(this.directory, 'backups', name);
  }
  /** The public header of a managed backup: vault id, revision and wrappers digest. Never decrypts. */
  async backupHeader(name: string): Promise<{ vaultId: string; revision: number; wrappersDigest: string } | null> {
    try {
      const value = JSON.parse(await readBoundedText(this.backupPath(name)));
      const envelope = value?.envelope;
      if (value?.backupFormat !== 'chausar.backup.v1' || typeof envelope?.id !== 'string' || !VAULT_ID.test(envelope.id)
        || !Number.isSafeInteger(envelope.revision) || !envelope.passphrase || !envelope.recovery) return null;
      return { vaultId: envelope.id, revision: envelope.revision, wrappersDigest: wrappersDigestOf(envelope) };
    } catch { return null; }
  }
  async backupViews(workspaceId: string | null, cards: VaultCard[]): Promise<{ backups: BackupView[]; more: boolean }> {
    const files = await this.backupFiles(workspaceId), views: BackupView[] = [];
    const byVault = new Map(cards.filter(card => card.vaultId && card.state === 'ready').map(card => [card.vaultId as string, card]));
    for (const file of files.slice(0, BACKUP_LIST_MAX)) {
      const header = await this.backupHeader(file.name); if (!header) continue;
      const card = byVault.get(header.vaultId);
      views.push({ file: file.name, kind: file.kind, at: new Date(file.at).toISOString(), revision: header.revision, bytes: file.bytes,
        name: card?.name ?? null, opensNow: !!card?.wrappersDigest && card.wrappersDigest === header.wrappersDigest });
    }
    return { backups: views, more: files.length > BACKUP_LIST_MAX };
  }
  /** This business's encrypted exports (`exports/chausar-<workspaceId>-<ms>.vault`), absolute paths. Plaintext exports are left out. */
  async exportFiles(workspaceId: string): Promise<string[]> {
    const folder = await this.#folder(join(this.directory, 'exports'), false); if (!folder) return [];
    const prefix = `chausar-${workspaceId}-`, found: string[] = [];
    for (const name of await readdir(folder)) {
      if (!name.startsWith(prefix) || !/^\d{1,16}\.vault$/.test(name.slice(prefix.length))) continue;
      try { const info = await lstat(join(folder, name)); if (info.isFile() && !info.isSymbolicLink()) found.push(join(folder, name)); }
      catch { /* removed while listing */ }
    }
    return found.sort();
  }
  async removeBackup(name: string) { await this.#remove(this.backups, name); }

  // -------------------------------------------------------------- C5 task 23: a copy on a drive or folder

  /** Copies a managed backup to the owner's folder as ciphertext, under its own name, then keeps that business's newest 5 there. Nothing else in the folder is touched. */
  async copyBackupOut(name: string, folder: string, workspaceId: string): Promise<void> {
    const parsed = parseBackupName(name);
    check(parsed && parsed.workspaceId === workspaceId, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    if (!(await stat(folder)).isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' });
    const part = join(folder, `.${name}.${randomBytes(6).toString('hex')}.part`);
    try { await copyFile(this.backupPath(name), part); await rename(part, join(folder, name)); }
    catch (error) { await unlink(part).catch(() => {}); throw error; }
    const mine = (await readdir(folder)).flatMap(item => { const read = parseBackupName(item); return read && read.workspaceId === workspaceId ? [read] : []; }).sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
    for (const old of mine.slice(COPY_KEEP)) await unlink(join(folder, old.name)).catch(() => {});
  }

  // -------------------------------------------------------------- C5 task 22: readable exports still on this computer

  async #readableNotes(): Promise<ReadableNote[]> {
    const value = await this.#readJson(join(this.directory, 'custody'), 'exports.json').catch(() => null);
    return Array.isArray(value?.readable) ? value.readable.filter((note: any) => typeof note?.file === 'string' && READABLE_NAME.test(note.file) && typeof note.at === 'string') : [];
  }
  async #writeReadable(readable: ReadableNote[]) { await this.#write(join(this.directory, 'custody'), 'exports.json', { readable }); }
  async noteReadable(file: string, at: string, path?: string) {
    check(READABLE_NAME.test(file), 'EXPORT_NOT_FOUND', 'That copy is not in the exports folder any more.');
    await this.#writeReadable([...await this.#readableNotes(), { file, at, kept: false, ...(path ? { path } : {}) }]);
  }
  /** This business's readable copies the owner hasn't said to keep, oldest first. A file gone by itself drops off quietly. */
  async readableExports(workspaceId: string): Promise<{ file: string; at: string }[]> {
    const folder = await this.#folder(join(this.directory, 'exports'), false);
    const notes = await this.#readableNotes(), present: ReadableNote[] = [];
    for (const note of notes) {
      if (!folder) break;
      try { const info = await lstat(note.path ?? join(folder, note.file)); if (info.isFile() && !info.isSymbolicLink()) present.push(note); } catch { /* gone */ }
    }
    if (present.length !== notes.length) await this.#writeReadable(present).catch(() => {});
    const prefix = `chausar-${workspaceId}-`;
    return present.filter(note => !note.kept && note.file.startsWith(prefix)).sort((a, b) => a.at.localeCompare(b.at)).map(({ file, at }) => ({ file, at }));
  }
  async keepReadable(file: string) {
    const notes = await this.#readableNotes();
    check(notes.some(note => note.file === file), 'EXPORT_NOT_FOUND', 'That copy is not in the exports folder any more.');
    await this.#writeReadable(notes.map(note => (note.file === file ? { ...note, kept: true } : note)));
  }
  /** Deletes exactly that readable copy, and only one Chausar noted. */
  async deleteReadable(file: string) {
    const notes = await this.#readableNotes();
    check(READABLE_NAME.test(file) && notes.some(note => note.file === file), 'EXPORT_NOT_FOUND', 'That copy is not in the exports folder any more.');
    const saved = notes.find(note => note.file === file)?.path;
    if (saved) await unlink(saved).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    else await this.#remove(join(this.directory, 'exports'), file);
    await this.#writeReadable(notes.filter(note => note.file !== file));
  }
  async transferFile(text: string): Promise<string> {
    const folder = await this.#folder(this.transfers, true);
    const path = join(folder!, `${randomBytes(12).toString('hex')}.backup`);
    await atomicWriteText(path, text, false); return path;
  }
  async removeTransfer(path: string) {
    const folder = await this.#folder(this.transfers, false); if (!folder) return;
    const name = path.slice(folder.length + 1);
    if (path.startsWith(folder) && /^[a-f0-9]{24}\.backup$/.test(name)) await this.#remove(folder, name);
  }
}
export function validCard(card: any): card is VaultCard {
  return !!card && card.format === CARD_FORMAT && typeof card.folder === 'string' && FOLDER_RULE.test(card.folder)
    && (card.vaultId === null || typeof card.vaultId === 'string' && VAULT_ID.test(card.vaultId))
    && ['this-computer', 'passphrase'].includes(card.unlock) && ['made', 'not-made', 'unknown'].includes(card.recovery)
    && ['creating', 'ready'].includes(card.state) && CARD_PENDING.includes(card.pending)
    && (card.name === null || typeof card.name === 'string' && card.name.length <= 200);
}
export function newCard(fields: Partial<VaultCard> & Pick<VaultCard, 'folder' | 'unlock' | 'recovery'>): VaultCard {
  return { format: CARD_FORMAT, vaultId: null, workspaceId: null, name: null, demo: null, wrappersDigest: null,
    state: 'ready', pending: null, createdAt: new Date().toISOString(), openedAt: null, ...fields };
}

// ---------------------------------------------------------------- backup names, rotation, schedule

export type ParsedBackup = { name: string; workspaceId: string; at: number; kind: BackupKind; legacy: boolean };
export type BackupFile = ParsedBackup & { bytes: number };
/** The tail after `chausar-<workspaceId>-` that a managed backup or export may have. */
export const MANAGED_COPY_TAIL = /^(?:\d+(?:-(?:auto|manual|safety))?\.(backup|json|vault)|ca-\d{4}-\d{2}(?:\.csv|-receipts\.json))$/;
const BACKUP_NAME = /^chausar-([A-Za-z0-9_-]{1,200})-(\d{1,16})(?:-(auto|manual|safety))?\.backup$/;
export function parseBackupName(name: string): ParsedBackup | null {
  if (typeof name !== 'string') return null;
  const match = BACKUP_NAME.exec(name); if (!match) return null;
  const at = Number(match[2]); if (!Number.isSafeInteger(at)) return null;
  return { name, workspaceId: match[1], at, kind: (match[3] as BackupKind | undefined) ?? 'manual', legacy: !match[3] };
}
export const backupName = (workspaceId: string, at: number, kind: BackupKind) => `chausar-${workspaceId}-${at}-${kind}.backup`;

const DAY = 86_400_000;
/** ISO weeks start on Monday; 1 January 1970 was a Thursday. */
const isoWeek = (ms: number) => Math.floor((Math.floor(ms / DAY) + 3) / 7);
/** KEYCHAIN-SPEC 4.3. Among `auto` files keep the union of the 10 newest, the newest of each of the last 14 UTC days
 * and the newest of each of the last 8 ISO weeks; keep the 5 newest `safety` files; never touch `manual` ones. */
export function keepBackups(files: { name: string; kind: BackupKind; at: number }[], now: number): { keep: string[]; remove: string[] } {
  const keep = new Set<string>();
  const newestFirst = (kind: BackupKind) => files.filter(file => file.kind === kind).sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const auto = newestFirst('auto');
  auto.slice(0, AUTO_BACKUP.keepRecent).forEach(file => keep.add(file.name));
  const today = Math.floor(now / DAY), week = isoWeek(now), days = new Set<number>(), weeks = new Set<number>();
  for (const file of auto) {
    const day = Math.floor(file.at / DAY), fileWeek = isoWeek(file.at);
    if (today - day < AUTO_BACKUP.keepDailyDays && !days.has(day)) { days.add(day); keep.add(file.name); }
    if (week - fileWeek < AUTO_BACKUP.keepWeeklyWeeks && !weeks.has(fileWeek)) { weeks.add(fileWeek); keep.add(file.name); }
  }
  newestFirst('safety').slice(0, AUTO_BACKUP.keepSafety).forEach(file => keep.add(file.name));
  files.filter(file => file.kind === 'manual').forEach(file => keep.add(file.name));
  return { keep: files.filter(file => keep.has(file.name)).map(file => file.name), remove: files.filter(file => !keep.has(file.name)).map(file => file.name) };
}
export type BackupSchedule = { lastAt: number | null; lastRevision: number | null; due: boolean; lastError: string | null };
/** KEYCHAIN-SPEC 4.1: due when the revision changed since the last backup and it is older than six hours,
 * or an important change asked for one and the last is at least two minutes old. */
export function backupDue(state: BackupSchedule, revision: number, now: number): boolean {
  if (state.lastRevision === revision) return false;
  if (state.lastAt === null) return true;
  if (now - state.lastAt >= AUTO_BACKUP.everyMs) return true;
  return state.due && now - state.lastAt >= AUTO_BACKUP.minGapMs;
}
export function nextBackupAt(state: BackupSchedule, revision: number, now: number): number | null {
  if (state.lastRevision === revision) return null;
  if (state.lastAt === null) return now;
  return state.due ? Math.max(now, state.lastAt + AUTO_BACKUP.minGapMs) : state.lastAt + AUTO_BACKUP.everyMs;
}

// ---------------------------------------------------------------- the move code

/** CHT- and 24 Crockford base32 characters: 15 random bytes, 120 bits. */
export function makeTransferCode(): string {
  const bytes = randomBytes(15); let bits = 0, value = 0, out = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += TRANSFER.alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  bytes.fill(0);
  return `${TRANSFER.prefix}${out}`;
}
/** Upper case, no spaces or dashes after the prefix, O to 0, I and L to 1; null when it isn't 24 alphabet characters. */
export function normalizeTransferCode(text: string): string | null {
  if (typeof text !== 'string' || text.length > 200) return null;
  let body = text.trim().toUpperCase().replace(/\s+/g, '');
  if (body.startsWith(TRANSFER.prefix)) body = body.slice(TRANSFER.prefix.length);
  else if (body.startsWith('CHT')) body = body.slice(3);
  body = body.replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (body.length !== TRANSFER.length || [...body].some(char => !TRANSFER.alphabet.includes(char))) return null;
  return `${TRANSFER.prefix}${body}`;
}

// ---------------------------------------------------------------- the words for the computer

export function computerView(scheme: DeviceScheme | null, probe: { available: true } | { available: false; reason: DeviceUnavailableReason }, checked: boolean): ComputerCustodyView {
  if (probe.available && scheme) return { available: true, scheme, reason: null, checked, where: CUSTODY_WORDS.where[scheme], loss: CUSTODY_WORDS.loss[scheme] };
  const reason = probe.available ? 'failed' : probe.reason;
  return { available: false, scheme, reason, checked: false, where: CUSTODY_WORDS.unavailable[reason], loss: null };
}

/** How this computer keeps vault keys: CHAUSAR_DEVICE_KEYS=none asks for a passphrase; CHAUSAR_AUTO_BACKUPS=off stops automatic backups. */
export function workspaceCustodyEnv(environment: NodeJS.ProcessEnv): { deviceKeys: 'os' | 'none'; autoBackups: boolean } {
  return { deviceKeys: environment.CHAUSAR_DEVICE_KEYS === 'none' ? 'none' : 'os', autoBackups: environment.CHAUSAR_AUTO_BACKUPS !== 'off' };
}
