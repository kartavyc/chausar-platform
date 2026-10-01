import { PhoneError, requirePhone, validBinding, validBrief, isId } from './contracts.ts';
import type { Brief, BriefCache, CachedBrief, DeviceBinding } from './contracts.ts';

/** A dedicated brief-only namespace. Implementations must copy bytes on reads/writes. */
export interface OpaqueBriefStorage {
  list(): Promise<string[]>;
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Provision separately using the selected platform's protected credential store.
 * getKey must return an existing, nonexportable AES-256-GCM key for this binding,
 * or undefined when locked/revoked; it must never silently create a replacement.
 * clear destroys all keys in this dedicated brief-cache namespace.
 */
export interface BriefCacheKeyProvider {
  getKey(binding: DeviceBinding): Promise<CryptoKey | undefined>;
  clear(): Promise<void>;
}

export type EncryptedBriefCacheOptions = {
  crypto: Crypto;
  storage: OpaqueBriefStorage;
  keys: BriefCacheKeyProvider;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxRecordBytes?: number;
  maxTotalBytes?: number;
};

const DAY = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * DAY;
const MAX_ENTRIES = 50;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const FORMAT = 'chausar-phone-brief-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const opaqueKey = (key: string) => /^[a-f0-9]{64}$/.test(key);
const bindingText = (binding: DeviceBinding) => JSON.stringify([binding.workspaceId, binding.memberId, binding.deviceId, binding.epoch]);
const allowedBinding = (binding: DeviceBinding): DeviceBinding => ({ workspaceId: binding.workspaceId, memberId: binding.memberId, deviceId: binding.deviceId, epoch: binding.epoch });
const allowedBrief = (brief: Brief): Brief => ({
  id: brief.id, workspaceId: brief.workspaceId, version: brief.version,
  generatedAt: brief.generatedAt, title: brief.title, summary: brief.summary,
  receiptIds: [...brief.receiptIds],
});
const boundInteger = (value: number, maximum: number) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

/**
 * Portable encrypted snapshots, never authority. A namespace is dedicated to one
 * companion device; changing pairing should clear it. put also discards entries
 * it cannot authenticate to the supplied binding. Offline views must be marked
 * cached/read-only by the client, and are never inputs to approval execution.
 */
export class EncryptedBriefCache implements BriefCache {
  private readonly crypto: Crypto;
  private readonly storage: OpaqueBriefStorage;
  private readonly keys: BriefCacheKeyProvider;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxRecordBytes: number;
  private readonly maxTotalBytes: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: EncryptedBriefCacheOptions) {
    this.crypto = options.crypto; this.storage = options.storage; this.keys = options.keys;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DAY;
    this.maxEntries = options.maxEntries ?? 12;
    this.maxRecordBytes = options.maxRecordBytes ?? 64 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 512 * 1024;
    requirePhone(boundInteger(this.ttlMs, MAX_TTL_MS) && boundInteger(this.maxEntries, MAX_ENTRIES)
      && boundInteger(this.maxRecordBytes, MAX_RECORD_BYTES) && boundInteger(this.maxTotalBytes, MAX_TOTAL_BYTES)
      && this.maxTotalBytes >= this.maxRecordBytes, 'CACHE_INVALID');
  }

  async put(binding: DeviceBinding, brief: Brief): Promise<void> {
    // Snapshot caller-owned data before awaiting, including arrays and binding.
    let snapshot: Brief, owner: DeviceBinding;
    try {
      requirePhone(validBinding(binding) && validBrief(brief) && brief.workspaceId === binding.workspaceId, 'CACHE_INVALID');
      snapshot = allowedBrief(brief); owner = allowedBinding(binding);
    } catch { throw new PhoneError('CACHE_INVALID'); }
    return this.serial(async () => {
      const time = this.time(); const key = await this.encryptionKey(owner);
      const id = await this.recordKey(owner, snapshot.id);
      const payload: CachedBrief = { ...snapshot, cachedAt: new Date(time).toISOString(), expiresAt: new Date(time + this.ttlMs).toISOString() };
      const plaintext = encoder.encode(JSON.stringify(payload));
      requirePhone(plaintext.byteLength + 29 <= this.maxRecordBytes, 'CACHE_INVALID');
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = new Uint8Array(await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.aad(owner, id), tagLength: 128 }, key, plaintext));
      const bytes = new Uint8Array(13 + encrypted.byteLength);
      bytes[0] = 1; bytes.set(iv, 1); bytes.set(encrypted, 13);
      const retained: { id: string; size: number; cachedAt: number }[] = [];
      for (const existingId of await this.entries()) {
        const existing = await this.storage.get(existingId);
        if (!existing) continue;
        if (existingId === id) continue;
        try {
          const cached = await this.decode(owner, existingId, existing, key, time);
          if (cached) retained.push({ id: existingId, size: existing.byteLength, cachedAt: Date.parse(cached.cachedAt) });
          else await this.storage.remove(existingId);
        } catch { await this.storage.remove(existingId); }
      }
      retained.sort((a, b) => a.cachedAt - b.cachedAt || a.id.localeCompare(b.id));
      let total = bytes.byteLength + retained.reduce((sum, record) => sum + record.size, 0);
      while (retained.length + 1 > this.maxEntries || total > this.maxTotalBytes) {
        const oldest = retained.shift();
        requirePhone(oldest, 'CACHE_INVALID');
        await this.storage.remove(oldest.id); total -= oldest.size;
      }
      await this.storage.set(id, bytes);
    });
  }

  async read(binding: DeviceBinding, briefId: string): Promise<CachedBrief | undefined> {
    requirePhone(validBinding(binding) && isId(briefId), 'CACHE_INVALID');
    const owner = allowedBinding(binding);
    return this.serial(async () => {
      const id = await this.recordKey(owner, briefId);
      const bytes = await this.storage.get(id);
      if (!bytes) return undefined;
      try {
        const cached = await this.decode(owner, id, bytes, await this.encryptionKey(owner), this.time());
        requirePhone(!cached || cached.id === briefId, 'CACHE_INVALID');
        if (!cached) await this.storage.remove(id);
        return cached;
      } catch {
        await this.storage.remove(id);
        throw new PhoneError('CACHE_INVALID');
      }
    });
  }

  /** Enumerates authenticated read-only snapshots without a plaintext brief index. */
  async list(binding: DeviceBinding): Promise<CachedBrief[]> {
    requirePhone(validBinding(binding), 'CACHE_INVALID');
    const owner = allowedBinding(binding);
    return this.serial(async () => {
      const ids = await this.entries();
      if (ids.length === 0) return [];
      // A locked key is reported before touching records, allowing the platform
      // to unlock it later without making encrypted data into session authority.
      const key = await this.encryptionKey(owner);
      const time = this.time();
      const retained: { id: string; size: number; brief: CachedBrief }[] = [];
      for (const id of ids) {
        const bytes = await this.storage.get(id);
        if (!bytes) continue;
        let cached: CachedBrief | undefined;
        try { cached = await this.decode(owner, id, bytes, key, time); }
        catch { await this.storage.remove(id); continue; }
        if (cached) retained.push({ id, size: bytes.byteLength, brief: cached });
        else await this.storage.remove(id);
      }
      retained.sort((a, b) => Date.parse(b.brief.cachedAt) - Date.parse(a.brief.cachedAt) || a.brief.id.localeCompare(b.brief.id));
      let total = retained.reduce((sum, record) => sum + record.size, 0);
      // A restart can select stricter budgets than the writer used. Keep the
      // newest authenticated records and remove older excess before returning.
      while (retained.length > this.maxEntries || total > this.maxTotalBytes) {
        const oldest = retained.pop();
        requirePhone(oldest, 'CACHE_INVALID');
        await this.storage.remove(oldest.id); total -= oldest.size;
      }
      return retained.map(record => record.brief);
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      // Attempt both erasure paths even if an adapter fails. A failed clear is
      // reported; no local key references survive this method or an earlier put.
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.storage.clear()),
        Promise.resolve().then(() => this.keys.clear()),
      ]);
      requirePhone(results.every(result => result.status === 'fulfilled'), 'CACHE_INVALID');
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation).catch(() => { throw new PhoneError('CACHE_INVALID'); });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private time(): number {
    const time = this.now();
    requirePhone(Number.isSafeInteger(time) && time >= 0 && time + MAX_TTL_MS <= 8_640_000_000_000_000, 'CACHE_INVALID');
    return time;
  }

  private async encryptionKey(binding: DeviceBinding): Promise<CryptoKey> {
    const key = await this.keys.getKey(binding);
    requirePhone(key && key.type === 'secret' && !key.extractable && key.algorithm.name === 'AES-GCM'
      && (key.algorithm as AesKeyAlgorithm).length === 256 && key.usages.includes('encrypt') && key.usages.includes('decrypt'), 'CACHE_INVALID');
    return key;
  }

  private async recordKey(binding: DeviceBinding, id: string): Promise<string> {
    const digest = new Uint8Array(await this.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([FORMAT, bindingText(binding), id]))));
    return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private aad(binding: DeviceBinding, id: string): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify([FORMAT, bindingText(binding), id]));
  }

  private async entries(): Promise<string[]> {
    const entries = await this.storage.list();
    // A dedicated namespace normally has <=50 records. Bound malformed adapter
    // output so a corrupt index cannot cause an unbounded decrypt/eviction scan.
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES * 2 || entries.some(id => !opaqueKey(id)) || new Set(entries).size !== entries.length) {
      await this.storage.clear(); throw new PhoneError('CACHE_INVALID');
    }
    return entries;
  }

  private async decode(binding: DeviceBinding, id: string, bytes: Uint8Array, key: CryptoKey, time: number): Promise<CachedBrief | undefined> {
    requirePhone(bytes instanceof Uint8Array && bytes.byteLength >= 29 && bytes.byteLength <= this.maxRecordBytes && bytes[0] === 1, 'CACHE_INVALID');
    const plaintext = await this.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: this.aad(binding, id), tagLength: 128 }, key, bytes.slice(13));
    const parsed = JSON.parse(decoder.decode(plaintext)) as CachedBrief;
    requirePhone(validBrief(parsed) && parsed.workspaceId === binding.workspaceId && await this.recordKey(binding, parsed.id) === id, 'CACHE_INVALID');
    requirePhone(typeof parsed.cachedAt === 'string' && typeof parsed.expiresAt === 'string', 'CACHE_INVALID');
    const cachedAt = Date.parse(parsed.cachedAt), expiresAt = Date.parse(parsed.expiresAt);
    requirePhone(Number.isFinite(cachedAt) && Number.isFinite(expiresAt) && cachedAt <= time && expiresAt > cachedAt && expiresAt - cachedAt <= this.ttlMs, 'CACHE_INVALID');
    if (expiresAt <= time) return undefined;
    // Copy only known brief fields, even if a future producer adds other data.
    return { ...allowedBrief(parsed), cachedAt: parsed.cachedAt, expiresAt: parsed.expiresAt };
  }
}
