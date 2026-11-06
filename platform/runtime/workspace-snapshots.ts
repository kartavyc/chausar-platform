// Business snapshots (Ink v2 wave 4, package 4J6, catalogue C10): what the other businesses on this computer may know
// about one that is closed, and the never-contact list they share. Each business keeps its own encrypted vault and
// only one opens at a time, so "All businesses", Chats and the Start gallery read a small summary instead: name, the
// playbook its idea picks, money totals as code added them (with their receipt ids in that business), counts of runs
// and of what needs the owner, and when it was taken. Never a client's name, a title, a message or a file: write()
// refuses any other field. A summary is encrypted (AES-256-GCM, the folder bound in) with a key the operating system
// keeps for this login (custody/summary-key.json holds only its protected record, like a vault's key record), so a
// copy of the folder on another computer, a tampered file or a file moved to another business's name reads as
// unreadable. The never-contact list (custody/never-contact.json) holds keyed one-way checks (HMAC-SHA256) of every
// blocked or forgotten address, with a MAC over them, under its own key the operating system keeps
// (custody/never-contact-key.json); it cannot be turned back into an address, and it fails closed, never empty.
// Only the engine writes here; a business that opens with a passphrase never gets a summary (the engine's rule).
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError, check } from './contracts.ts';
import { atomicWriteText, readBoundedText, safeDirectory } from './vault.ts';
import type { DeviceKeyRecord, DeviceKeyStore } from './device-custody.ts';
import { FOLDER_RULE } from './workspace-custody.ts';
import type { BusinessSnapshot, BusinessSnapshotRead, SnapshotFigure, VentureBusinessRef } from './venture/contracts.ts';

export const SNAPSHOT_FORMAT = 'chausar.snapshot.v1';
const FILE_FORMAT = 'chausar.snapshot-file.v1';
export const NEVER_CONTACT_FORMAT = 'chausar.never-contact.v1';
/** The id the operating system keeps the summary key under (a vault id never looks like it: they are vault_...). */
export const SNAPSHOT_KEY_ID = 'chausar-summaries';
/** A business writes its summary at most once a minute while it changes, and again on lock. */
export const SNAPSHOT_EVERY_MS = 60_000;
/** The never-contact list keeps at most this many checks; the oldest are never dropped, a full list refuses more. */
export const NEVER_CONTACT_MAX = 50_000;
export const NEVER_CONTACT_UNAVAILABLE = "Chausar can't check your never-contact list on this computer right now, so it drafts nothing. Try again in a moment.";
/** The id the operating system keeps the never-contact list's own key under. */
export const NEVER_CONTACT_KEY_ID = 'chausar-never-contact';
export const NEVER_CONTACT_LOST_LINE = "Chausar can no longer check the never-contact list on this computer, so it drafts nothing. You can start a new list: each business adds its own blocklist again when you next open it, but people forgotten in other businesses can't be put back.";
export const NEVER_CONTACT_RESET_LINE = "Chausar started a new never-contact list on this computer. Each business adds its own blocklist again the next time you open it. People forgotten in other businesses can't be put back on it.";

/** When the open business writes its summary: the first look after it opens, then after a change and a minute; always on lock. */
export function snapshotDue(last: { at: number | null; revision: number | null }, revision: number, now: number, lock: boolean): boolean {
  if (lock || last.at === null) return true;
  return last.revision !== revision && now - last.at >= SNAPSHOT_EVERY_MS;
}

// ---------------------------------------------------------------- the summary's shape

const keysOf = (value: object) => Object.keys(value).sort().join(',');
const plain = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** A money figure as code formats it: 'INR 45,000.00', 'INR -1,000.00', 'JPY 5,000', 'USD 1.2500'. Words never fit. */
const MONEY_DISPLAY = /^[A-Z]{3} -?\d{1,3}(?:,\d{3})*(?:\.\d{1,6})?$/;
const RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

/** One figure of its kind, in the currency it must be in: the business's own, or US dollars for AI spend (micros). */
function validFigure(value: unknown, currency: string, unit: 'minor' | 'micros'): value is SnapshotFigure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as SnapshotFigure;
  return keysOf(item) === 'amount,currency,display,receiptId,unit' && /^-?\d{1,30}$/.test(item.amount) && item.unit === unit
    && item.currency === currency && typeof item.display === 'string' && MONEY_DISPLAY.test(item.display) && item.display.startsWith(`${currency} `)
    && typeof item.receiptId === 'string' && RECEIPT_ID.test(item.receiptId);
}

/** Exactly the fields of a summary, each of its kind: anything else (a client's words, a note) makes it invalid. */
export function validSnapshot(value: unknown, folder: string): value is BusinessSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as BusinessSnapshot;
  if (keysOf(item) !== 'asOf,businessId,format,money,name,needsYou,playbook,runs,vaultId') return false;
  if (item.format !== SNAPSHOT_FORMAT || item.businessId !== folder || !plain(item.vaultId, 100) || !plain(item.name, 200)) return false;
  if (!(item.playbook === null || plain(item.playbook, 80)) || typeof item.asOf !== 'string' || !ISO.test(item.asOf) || !count(item.needsYou)) return false;
  const runs = item.runs;
  if (!runs || typeof runs !== 'object' || keysOf(runs) !== 'stopped,waiting,working' || !count(runs.working) || !count(runs.waiting) || !count(runs.stopped)) return false;
  const money = item.money;
  if (money === null) return true;
  if (!money || typeof money !== 'object' || keysOf(money) !== 'currency,invoiced,late,month,owed,received,spend') return false;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(money.month) && /^[A-Z]{3}$/.test(money.currency) && count(money.late)
    && [money.invoiced, money.received, money.owed].every(figure => validFigure(figure, money.currency, 'minor'))
    && validFigure(money.spend, 'USD', 'micros');
}

// ---------------------------------------------------------------- the files

type SealedFile = { format: typeof FILE_FORMAT; keyId: string; iv: string; tag: string; data: string };
type NeverContactFile = { format: typeof NEVER_CONTACT_FORMAT; scheme: 'hmac-sha256'; keyId: string; hashes: string[]; mac: string };
/** NEVER_CONTACT_LOST: the list exists but can no longer be checked. */
const lost = () => new ChausarError('NEVER_CONTACT_LOST', NEVER_CONTACT_LOST_LINE);
const HASH = /^[0-9a-f]{64}$/;

/**
 * The summaries and the never-contact list of the businesses on this computer. keys: the computer's key store, or null
 * where there is none (then nothing is written or read). The key is asked of the operating system once and kept for
 * the life of this object; forgetKey() wipes it.
 */
export class WorkspaceSnapshots {
  readonly directory: string;
  #keys: () => DeviceKeyStore | null;
  #key: Buffer | null = null;
  #listKey: Buffer | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  constructor(directory: string, keys: () => DeviceKeyStore | null) { this.directory = directory; this.#keys = keys; }

  get #folder() { return join(this.directory, 'custody', 'snapshots'); }
  get #keyFile() { return join(this.directory, 'custody', 'summary-key.json'); }
  get #listFile() { return join(this.directory, 'custody', 'never-contact.json'); }

  /** One write at a time, so two changes never race on the same file. */
  #serial<T>(work: () => Promise<T>): Promise<T> { const next = this.#chain.then(work); this.#chain = next.catch(() => {}); return next; }

  async #readJson(path: string): Promise<unknown | null> {
    try { return JSON.parse(await readBoundedText(path)); }
    catch (error: any) { if (error?.code === 'ENOENT' || error?.message === 'Missing file') return null; return undefined; }
  }

  /**
   * This computer's summary key, or null when the key store does not answer. create: make one when there is none (or
   * the operating system lost it, which can never come back); only writes create.
   */
  async #computerKey(create: boolean): Promise<Buffer | null> {
    if (this.#key) return this.#key;
    const keys = this.#keys(); if (!keys) return null;
    const record = await this.#readJson(this.#keyFile) as DeviceKeyRecord | null | undefined;
    if (record && record.format === 'chausar.device-key.v1' && record.vaultId === SNAPSHOT_KEY_ID) {
      let secret: Buffer | null;
      try { secret = await keys.unprotect(record); } catch { return null; }
      if (secret && secret.length === 32) return (this.#key = secret);
      if (secret) secret.fill(0);
    }
    if (!create) return null;
    const secret = randomBytes(32);
    let made: DeviceKeyRecord | null = null;
    try {
      made = await keys.protect(SNAPSHOT_KEY_ID, secret);
      await safeDirectory(join(this.directory, 'custody'), true);
      await atomicWriteText(this.#keyFile, JSON.stringify(made), true);
    } catch {
      if (made) await keys.forget(made).catch(() => {});
      secret.fill(0); return null;
    }
    return (this.#key = secret);
  }
  /** Wipes the key kept in memory; the next read asks the operating system again. */
  forgetKey(): void { this.#key?.fill(0); this.#key = null; this.#listKey?.fill(0); this.#listKey = null; }

  #subkey(key: Buffer, purpose: string): Buffer { return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), purpose, 32)); }
  #keyId(key: Buffer): string { return createHash('sha256').update(this.#subkey(key, 'chausar.summary-key-id.v1')).digest('hex').slice(0, 16); }

  /** Encrypts and writes one business's summary. Refuses (INVALID_SNAPSHOT) any other shape; DEVICE_KEY_FAILED without a key. */
  async write(folder: string, snapshot: BusinessSnapshot): Promise<void> {
    check(FOLDER_RULE.test(folder) && validSnapshot(snapshot, folder), 'INVALID_SNAPSHOT', 'A business summary holds only its totals and counts.');
    await this.#serial(async () => {
      const key = await this.#computerKey(true);
      if (!key) throw new ChausarError('DEVICE_KEY_FAILED', "This computer's protected storage did not answer, so Chausar saved no summary.");
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#subkey(key, 'chausar.snapshot.v1'), iv);
      cipher.setAAD(Buffer.from(`${SNAPSHOT_FORMAT}\n${folder}`));
      const data = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
      const file: SealedFile = { format: FILE_FORMAT, keyId: this.#keyId(key), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
      await safeDirectory(this.#folder, true);
      await atomicWriteText(join(this.#folder, `${folder}.json`), JSON.stringify(file), true);
    });
  }

  /**
   * One business's summary: none when never written (or no key store here), unreadable when it fails to decrypt,
   * belongs to another vault (vaultId, when the card names one) or is not a summary; else saved.
   */
  async read(folder: string, vaultId: string | null): Promise<{ read: 'saved' | 'none' | 'unreadable'; snapshot: BusinessSnapshot | null }> {
    if (!FOLDER_RULE.test(folder) || !this.#keys()) return { read: 'none', snapshot: null };
    const file = await this.#readJson(join(this.#folder, `${folder}.json`)) as SealedFile | null | undefined;
    if (file === null) return { read: 'none', snapshot: null };
    const unreadable = { read: 'unreadable' as const, snapshot: null };
    if (!file || typeof file !== 'object' || file.format !== FILE_FORMAT || typeof file.iv !== 'string' || typeof file.tag !== 'string' || typeof file.data !== 'string') return unreadable;
    const key = await this.#computerKey(false); if (!key) return unreadable;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#subkey(key, 'chausar.snapshot.v1'), Buffer.from(file.iv, 'base64'));
      decipher.setAAD(Buffer.from(`${SNAPSHOT_FORMAT}\n${folder}`));
      decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
      const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8'));
      if (!validSnapshot(value, folder) || (vaultId !== null && value.vaultId !== vaultId)) return unreadable;
      return { read: 'saved', snapshot: value };
    } catch { return unreadable; }
  }

  /** Takes a business's summary away (it now needs a passphrase, or it was deleted). Never throws. */
  async remove(folder: string): Promise<void> {
    if (!FOLDER_RULE.test(folder)) return;
    await this.#serial(async () => {
      const path = join(this.#folder, `${folder}.json`);
      try { const info = await lstat(path); if (info.isFile() && !info.isSymbolicLink()) await unlink(path); } catch { /* none there */ }
    }).catch(() => {});
  }

  /**
   * The other businesses as their summaries read, the one open now (exclude) left out: one that does not open with
   * this computer is locked and never read; cards: the vault each folder belongs to, so a reused folder is unreadable.
   */
  async list(businesses: readonly VentureBusinessRef[], vaults: ReadonlyMap<string, string | null>, exclude: string | null): Promise<BusinessSnapshotRead[]> {
    const rows: BusinessSnapshotRead[] = [];
    for (const business of businesses) {
      if (business.id === exclude) continue;
      if (business.opens !== 'with-this-computer') { rows.push({ ...business, read: 'locked', snapshot: null }); continue; }
      const found = await this.read(business.id, vaults.get(business.id) ?? null).catch(() => ({ read: 'unreadable' as const, snapshot: null }));
      rows.push({ ...business, ...found });
    }
    return rows;
  }

  // -------------------------------------------------------------- the never-contact list
  // The list has its own key (custody/never-contact-key.json), never the summary key, so a new summary key never
  // touches it. A new list key is made only when there is no key file and the list is empty. Anything else that goes
  // wrong (a key record that can't be read, a key the operating system lost or gives back wrong, another key's list, a
  // list that is unreadable, of a bad shape or whose MAC fails) fails closed: the list is never emptied silently and
  // never overwritten; only the owner's explicit reset (neverContactReset) starts a new one.

  /** The one spelling a check is made of: trimmed and lower case (an email, a phone in E.164, a LinkedIn profile address). */
  #spelling(value: string): string { return String(value ?? '').trim().toLowerCase(); }
  #hash(key: Buffer, value: string): string { return createHmac('sha256', this.#subkey(key, NEVER_CONTACT_FORMAT)).update(`${NEVER_CONTACT_FORMAT}\n${value}`).digest('hex'); }
  #listKeyId(key: Buffer): string { return createHash('sha256').update(this.#subkey(key, 'chausar.never-contact-key-id.v1')).digest('hex').slice(0, 16); }
  #mac(key: Buffer, keyId: string, hashes: readonly string[]): string {
    return createHmac('sha256', this.#subkey(key, 'chausar.never-contact-mac.v1')).update(`${keyId}\n${hashes.join('\n')}`).digest('hex');
  }
  get #listKeyFile() { return join(this.directory, 'custody', 'never-contact-key.json'); }

  /** A file's text, null only when it does not exist; any other failure is TIER_UNAVAILABLE (it may answer later). */
  async #text(path: string): Promise<string | null> {
    try { return await readBoundedText(path); }
    catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      // 'Missing file' also means something that is not a plain file sits there: only nothing at all is no file.
      if (error?.message === 'Missing file') {
        const gone = await lstat(path).then(() => false, (failure: any) => failure?.code === 'ENOENT');
        if (gone) return null;
      }
      throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
    }
  }

  /** The list as stored, null only when there is no file. A list of a bad shape, or with any check not a check, is lost. */
  async #storedList(): Promise<NeverContactFile | null> {
    const text = await this.#text(this.#listFile);
    if (text === null) return null;
    let value: NeverContactFile;
    try { value = JSON.parse(text); } catch { throw lost(); }
    const sorted = (hashes: string[]) => hashes.every((hash, i) => i === 0 || hashes[i - 1] < hash);
    if (!value || typeof value !== 'object' || Array.isArray(value) || keysOf(value) !== 'format,hashes,keyId,mac,scheme' || value.format !== NEVER_CONTACT_FORMAT
      || value.scheme !== 'hmac-sha256' || typeof value.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(value.keyId) || typeof value.mac !== 'string'
      || !HASH.test(value.mac) || !Array.isArray(value.hashes) || !value.hashes.every(hash => typeof hash === 'string' && HASH.test(hash)) || !sorted(value.hashes)) throw lost();
    return value;
  }

  /**
   * The list's key: null only when there is no key file. A record that can't be read or is not a key record, a key the
   * operating system no longer has, refuses while it answers its probe, or gives back at the wrong length, is lost; an
   * operating system that does not answer at all, or no key store here, is TIER_UNAVAILABLE.
   */
  async #storedListKey(): Promise<Buffer | null> {
    if (this.#listKey) return this.#listKey;
    const keys = this.#keys(); if (!keys) throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
    const text = await this.#text(this.#listKeyFile);
    if (text === null) return null;
    let record: DeviceKeyRecord;
    try { record = JSON.parse(text); } catch { throw lost(); }
    if (!record || record.format !== 'chausar.device-key.v1' || record.vaultId !== NEVER_CONTACT_KEY_ID) throw lost();
    let secret: Buffer | null;
    try { secret = await keys.unprotect(record); }
    catch {
      // A store that answers its probe but refuses this key (DPAPI with the key gone bad) will not answer later either.
      const probe = await keys.probe().catch(() => ({ available: false as const }));
      if (probe.available) throw lost();
      throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
    }
    if (!secret) throw lost();
    if (secret.length !== 32) { secret.fill(0); throw lost(); }
    return (this.#listKey = secret);
  }

  /** The list checked against its key: its key id and its MAC, or lost. Null when there is no list. */
  async #checkedList(key: Buffer): Promise<NeverContactFile | null> {
    const list = await this.#storedList();
    if (!list) return null;
    const mac = Buffer.from(this.#mac(key, list.keyId, list.hashes), 'hex');
    if (list.keyId !== this.#listKeyId(key) || !timingSafeEqual(Buffer.from(list.mac, 'hex'), mac)) throw lost();
    return list;
  }

  /**
   * Whether any of these addresses is on the never-contact list. Neither a list nor a key yet, or an empty list with no
   * key yet, holds nobody. A key with no list beside it, and everything else that cannot be checked, refuses
   * (TIER_UNAVAILABLE or NEVER_CONTACT_LOST), never "nobody".
   */
  async neverContactHas(values: readonly string[]): Promise<boolean> {
    const stored = await this.#storedList();
    if (!stored) { if (await this.#text(this.#listKeyFile) !== null) throw lost(); return false; }
    const key = await this.#storedListKey();
    if (!key) { if (stored.hashes.length) throw lost(); return false; }
    const list = (await this.#checkedList(key))!;
    const listed = new Set(list.hashes);
    return values.map(value => this.#spelling(value)).filter(Boolean).some(value => listed.has(this.#hash(key, value)));
  }

  /**
   * Puts these addresses on the never-contact list for good, as keyed checks only. A new list key (with its empty list,
   * in the same step) is made only with no key file and no checks on the list; a key with no list, or a list it cannot
   * check, is never overwritten (it refuses as neverContactHas does).
   */
  async neverContactAdd(values: readonly string[]): Promise<void> {
    const spelled = [...new Set(values.map(value => this.#spelling(value)).filter(Boolean))];
    if (!spelled.length) return;
    await this.#serial(async () => {
      const stored = await this.#storedList();
      let key = await this.#storedListKey();
      if (!key) {
        if (stored?.hashes.length) throw lost();
        key = await this.#newListKey(); // writes its own empty list in place of an empty one it can't check
      } else if (!stored) throw lost();
      const list = (await this.#checkedList(key))!;
      const hashes = new Set(list.hashes);
      const before = hashes.size;
      for (const value of spelled) hashes.add(this.#hash(key, value));
      if (hashes.size === before) return;
      check(hashes.size <= NEVER_CONTACT_MAX, 'NEVER_CONTACT_FULL', 'Your never-contact list is full on this computer.');
      await this.#writeList(key, [...hashes].sort());
    });
  }

  async #newListKey(): Promise<Buffer> {
    const keys = this.#keys(); if (!keys) throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
    const secret = randomBytes(32);
    let made: DeviceKeyRecord | null = null;
    try {
      made = await keys.protect(NEVER_CONTACT_KEY_ID, secret);
      await safeDirectory(join(this.directory, 'custody'), true);
      await atomicWriteText(this.#listKeyFile, JSON.stringify(made), false);
      // The key and its empty list in one step: a key never stands without a list.
      await this.#writeList(secret, []);
    } catch {
      if (made) {
        await keys.forget(made).catch(() => {});
        await lstat(this.#listKeyFile).then(info => (info.isFile() && !info.isSymbolicLink() ? unlink(this.#listKeyFile) : undefined), () => undefined).catch(() => {});
      }
      secret.fill(0);
      throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
    }
    return (this.#listKey = secret);
  }

  async #writeList(key: Buffer, hashes: string[]): Promise<void> {
    const keyId = this.#listKeyId(key);
    const file: NeverContactFile = { format: NEVER_CONTACT_FORMAT, scheme: 'hmac-sha256', keyId, hashes, mac: this.#mac(key, keyId, hashes) };
    await safeDirectory(join(this.directory, 'custody'), true);
    await atomicWriteText(this.#listFile, JSON.stringify(file), true);
  }

  /**
   * The owner's explicit reset (the engine's resetNeverContact: owner only, inside the app): the old list and its key go
   * and a new empty list starts with a new key. Every business adds its own blocklist again the next time it is open;
   * people forgotten in other businesses can't be put back. Answers the words that say so.
   */
  async neverContactReset(): Promise<string> {
    return this.#serial(async () => {
      const keys = this.#keys(); if (!keys) throw new ChausarError('TIER_UNAVAILABLE', NEVER_CONTACT_UNAVAILABLE);
      try {
        const record = JSON.parse(await readBoundedText(this.#listKeyFile)) as DeviceKeyRecord;
        if (record?.format === 'chausar.device-key.v1' && record.vaultId === NEVER_CONTACT_KEY_ID) await keys.forget(record).catch(() => {});
      } catch { /* no key record, or one that could not be read: nothing to forget */ }
      this.#listKey?.fill(0); this.#listKey = null;
      for (const path of [this.#listFile, this.#listKeyFile]) {
        try { const info = await lstat(path); if (info.isFile() && !info.isSymbolicLink()) await unlink(path); } catch { /* none there */ }
      }
      await this.#newListKey();
      return NEVER_CONTACT_RESET_LINE;
    });
  }
}
