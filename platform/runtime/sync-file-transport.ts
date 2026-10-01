import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { check, ChausarError, hash } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import type { SyncHead, SyncLease, SyncSnapshot, SyncTransport } from './sync.ts';

export type FileSyncFaultPoint = 'after-lock' | 'after-blob' | 'before-state-commit' | 'after-state-commit';
export type FileSyncTransportOptions = {
  /** Existing dedicated local directory; all cooperating processes must use the same directory. */
  directory: string;
  workspaceId: string;
  vaultId: string;
  /** Trusted host clock, nonregressing across restart. Caller `now` is never lease authority. */
  clock?: () => Date;
  maxBlobBytes?: number;
  maxLeaseTtlMs?: number;
  /** Reliability fixture hook. Never install a hook in an admitted writer. */
  fault?: (point: FileSyncFaultPoint) => void | Promise<void>;
};
type Identity = { format: 'chausar.file-sync.v1'; storeId: string; workspaceId: string; vaultId: string };
type Authority = Identity & { fence: number; clockFloorMs: number; lease: SyncLease | null; head: SyncHead | null };
const MAX_BLOB = 96 * 1024 * 1024, MAX_BACKUP = 64 * 1024 * 1024, MAX_STATE = 8192;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SNAPSHOT_KEYS = 'ciphertextBase64,ciphertextDigest,createdAt,deviceId,epoch,fence,format,memberId,previousHash,revision,sequence,signature,signerId,vaultId,workspaceId';
const LEASE_KEYS = 'deviceId,epoch,expiresAt,fence,memberId,token';
const HEAD_KEYS = 'fence,recordHash,revision,sequence,vaultId,workspaceId';
const keys = (value: unknown, expected: string): boolean => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const textId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
function iso(value: unknown): value is string {
  return typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function base64(value: unknown, alphabet: 'base64' | 'base64url', bytes?: number): boolean {
  if (typeof value !== 'string' || !value.length || !(alphabet === 'base64' ? /^[A-Za-z0-9+/]+={0,2}$/ : /^[A-Za-z0-9_-]+$/).test(value)) return false;
  const decoded = Buffer.from(value, alphabet);
  return decoded.toString(alphabet) === value && (bytes === undefined || decoded.length === bytes);
}
function validLease(value: unknown): value is SyncLease {
  if (!keys(value, LEASE_KEYS)) return false;
  const lease = value as SyncLease;
  return textId(lease.deviceId) && textId(lease.memberId) && integer(lease.epoch, 1) && integer(lease.fence, 1) && iso(lease.expiresAt) && UUID.test(lease.token);
}
function validHead(value: unknown): value is SyncHead {
  if (!keys(value, HEAD_KEYS)) return false;
  const head = value as SyncHead;
  return HASH.test(head.recordHash) && textId(head.workspaceId) && textId(head.vaultId) && integer(head.revision) && integer(head.sequence, 1) && integer(head.fence, 1);
}
function sameLease(a: SyncLease, b: SyncLease): boolean {
  return a.token === b.token && a.fence === b.fence && a.deviceId === b.deviceId && a.memberId === b.memberId && a.epoch === b.epoch && a.expiresAt === b.expiresAt;
}
function headFor(recordHash: string, snapshot: SyncSnapshot): SyncHead {
  return { recordHash, workspaceId: snapshot.workspaceId, vaultId: snapshot.vaultId, revision: snapshot.revision, sequence: snapshot.sequence, fence: snapshot.fence };
}
function sameHead(a: SyncHead, b: SyncHead): boolean {
  return a.recordHash === b.recordHash && a.workspaceId === b.workspaceId && a.vaultId === b.vaultId && a.revision === b.revision && a.sequence === b.sequence && a.fence === b.fence;
}

/**
 * Local, cooperative-process filesystem implementation, not a cloud-folder/remote-peer adapter.
 * A single fsynced, atomically replaced authority record linearizes leases, fences and head CAS.
 * Blob publication precedes head publication; orphan ciphertext is never proof of a committed head.
 * Signer trust, membership admission and signatures remain SyncService/operator responsibilities.
 * The persisted clock floor detects rollback behind durable observations; the host clock must
 * remain trusted across restart. A kill can precede persistence of the latest clock sample.
 * No publication retries, garbage collection, stale-lease stealing or authority reset are performed.
 */
export class FileSyncTransport implements SyncTransport {
  readonly kind = 'local-file-ciphertext-store';
  readonly directory: string;
  readonly workspaceId: string;
  readonly vaultId: string;
  readonly #clock: () => Date;
  readonly #maxBlobBytes: number;
  readonly #maxLeaseTtlMs: number;
  readonly #fault?: FileSyncTransportOptions['fault'];

  constructor(options: FileSyncTransportOptions) {
    check(typeof options.directory === 'string' && isAbsolute(options.directory), 'SYNC_UNSAFE_PATH', 'Use an absolute dedicated local sync directory.');
    check(textId(options.workspaceId) && textId(options.vaultId), 'SYNC_WORKSPACE_MISMATCH', 'Bind the transport to exact workspace and vault identities.');
    this.directory = resolve(options.directory); this.workspaceId = options.workspaceId; this.vaultId = options.vaultId;
    this.#clock = options.clock ?? (() => new Date()); this.#fault = options.fault;
    this.#maxBlobBytes = options.maxBlobBytes ?? MAX_BLOB; this.#maxLeaseTtlMs = options.maxLeaseTtlMs ?? 120000;
    check(integer(this.#maxBlobBytes, 1) && this.#maxBlobBytes <= MAX_BLOB, 'SYNC_TOO_LARGE', 'The blob bound must be between 1 byte and 96 MiB.');
    check(integer(this.#maxLeaseTtlMs, 1) && this.#maxLeaseTtlMs <= 120000, 'INVALID_SYNC_LEASE', 'The lease bound must be between 1 ms and 120 seconds.');
  }

  async #directory(path: string): Promise<void> {
    for (let current = path; ; current = dirname(current)) {
      const stat = await lstat(current);
      check(stat.isDirectory() && !stat.isSymbolicLink(), 'SYNC_UNSAFE_PATH', 'Sync directories must be real local directories.');
      if (current === dirname(current)) return;
    }
  }
  async #read(path: string, limit: number): Promise<string | null> {
    let before; try { before = await lstat(path); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    check(before.isFile() && !before.isSymbolicLink(), 'SYNC_UNSAFE_PATH', 'Sync records must be regular files.');
    check(before.size > 0 && before.size <= limit, 'SYNC_TOO_LARGE', 'The sync record exceeds its bounded size.');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await file.stat();
      check(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size <= limit, 'SYNC_UNSAFE_PATH', 'The sync record changed while opening it.');
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const result = await file.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
      check(length === stat.size && length <= limit, 'SYNC_STORE_CORRUPT', 'The sync record changed while reading it.');
      const raw = bytes.subarray(0, length).toString('utf8');
      check(Buffer.from(raw).equals(bytes.subarray(0, length)), 'SYNC_STORE_CORRUPT', 'The sync record is not valid UTF-8.');
      return raw;
    } finally { await file.close(); }
  }
  #parse(raw: string): any {
    let value; try { value = JSON.parse(raw); } catch { throw new ChausarError('SYNC_STORE_CORRUPT', 'The sync store contains an invalid record.'); }
    check(JSON.stringify(value) === raw, 'SYNC_STORE_CORRUPT', 'The sync store record is not canonical JSON.');
    return value;
  }
  async #syncDirectory(path: string): Promise<void> {
    let file; try { file = await open(path, constants.O_RDONLY); await file.sync(); }
    catch (error: any) {
      // Node cannot flush a directory handle on Windows. This does not claim power-loss durability.
      if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error.code)) throw error;
    } finally { await file?.close(); }
  }
  async #write(path: string, raw: string, immutable: boolean, beforePublish?: () => void, published?: () => void): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(raw); await file.sync(); await file.close();
      beforePublish?.();
      if (immutable) { await link(temporary, path); await unlink(temporary); }
      else { await rename(temporary, path); }
      published?.();
      await this.#syncDirectory(dirname(path));
    } catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  }
  async #locked<T>(action: () => Promise<T>): Promise<T> {
    await this.#directory(this.directory);
    const lock = await acquireProcessLock(join(this.directory, '.writer.lock'), {
      busyCode: 'SYNC_STORE_BUSY', changedCode: 'SYNC_LOCK_CHANGED', unsafeCode: 'SYNC_UNSAFE_PATH',
      busyMessage: 'Another local process holds or may hold the sync transaction lock.',
    });
    try { await this.#fault?.('after-lock'); return await action(); }
    finally { await lock.release(); }
  }
  async #load(): Promise<Authority | null> {
    const identityRaw = await this.#read(join(this.directory, 'store.json'), MAX_STATE);
    if (identityRaw === null) {
      const entries = await readdir(this.directory);
      check(entries.every(name => name === '.writer.lock' || /^\.writer\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)$/.test(name)), 'SYNC_STORE_CORRUPT', 'An uninitialized sync directory must be empty; missing authority cannot be reset.');
      return null;
    }
    const identity = this.#parse(identityRaw) as Identity;
    check(keys(identity, 'format,storeId,vaultId,workspaceId') && identity.format === 'chausar.file-sync.v1' && UUID.test(identity.storeId) && textId(identity.workspaceId) && textId(identity.vaultId), 'SYNC_STORE_CORRUPT', 'The sync store identity is invalid.');
    check(identity.workspaceId === this.workspaceId && identity.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The sync directory belongs to another workspace or vault.');
    await this.#directory(join(this.directory, 'blobs'));
    const raw = await this.#read(join(this.directory, 'authority.json'), MAX_STATE);
    check(raw !== null, 'SYNC_STORE_CORRUPT', 'The persistent sync authority is missing; do not reset fencing.');
    const state = this.#parse(raw) as Authority;
    check(keys(state, 'clockFloorMs,fence,format,head,lease,storeId,vaultId,workspaceId') && state.format === identity.format && state.storeId === identity.storeId && state.workspaceId === identity.workspaceId && state.vaultId === identity.vaultId && integer(state.fence) && integer(state.clockFloorMs) && Number.isFinite(new Date(state.clockFloorMs).getTime()), 'SYNC_STORE_CORRUPT', 'The persistent sync authority is invalid.');
    check((state.lease === null && state.fence === 0 && state.head === null) || (validLease(state.lease) && state.lease.fence === state.fence), 'SYNC_STORE_CORRUPT', 'The persistent writer fence or lease is invalid.');
    check(state.head === null || (validHead(state.head) && state.head.workspaceId === this.workspaceId && state.head.vaultId === this.vaultId && state.head.fence <= state.fence), 'SYNC_STORE_CORRUPT', 'The persistent sync head is invalid.');
    if (state.head) {
      const snapshot = await this.#blob(state.head.recordHash);
      check(snapshot && sameHead(state.head, headFor(state.head.recordHash, snapshot)), 'SYNC_STORE_CORRUPT', 'The committed sync head has no matching immutable blob.');
    }
    return state;
  }
  async #initialize(): Promise<Authority> {
    const identity: Identity = { format: 'chausar.file-sync.v1', storeId: randomUUID(), workspaceId: this.workspaceId, vaultId: this.vaultId };
    await this.#write(join(this.directory, 'store.json'), JSON.stringify(identity), true);
    await mkdir(join(this.directory, 'blobs'), { mode: 0o700 }); await this.#syncDirectory(this.directory);
    const state: Authority = { ...identity, fence: 0, clockFloorMs: 0, lease: null, head: null };
    await this.#write(join(this.directory, 'authority.json'), JSON.stringify(state), false);
    return state;
  }
  #time(state: Authority): number {
    let ms: number; try { ms = this.#clock().getTime(); } catch { throw new ChausarError('SYNC_CLOCK_INVALID', 'The trusted sync clock is unavailable.'); }
    check(integer(ms) && Number.isFinite(new Date(ms).getTime()), 'SYNC_CLOCK_INVALID', 'The trusted sync clock must return a valid current Date.');
    check(ms >= state.clockFloorMs, 'SYNC_CLOCK_REGRESSED', 'The trusted sync clock regressed behind persistent writer authority.');
    return ms;
  }
  async #observeTime(state: Authority): Promise<number> {
    const time = this.#time(state);
    if (time > state.clockFloorMs) {
      state.clockFloorMs = time;
      await this.#write(join(this.directory, 'authority.json'), JSON.stringify(state), false);
    }
    return time;
  }
  async #commit(state: Authority, nextHead?: SyncHead): Promise<void> {
    await this.#fault?.('before-state-commit');
    let observedTime = state.clockFloorMs, published = false;
    if (nextHead) {
      observedTime = await this.#observeTime(state);
      check(state.lease && Date.parse(state.lease.expiresAt) > observedTime, 'FENCE_REJECTED', 'The writer lease expired before head publication.');
    }
    const next = nextHead ? { ...state, head: nextHead } : state;
    try {
      await this.#write(join(this.directory, 'authority.json'), JSON.stringify(next), false, nextHead ? () => {
        observedTime = this.#time(state);
        check(state.lease && Date.parse(state.lease.expiresAt) > observedTime, 'FENCE_REJECTED', 'The writer lease expired before the atomic head transition.');
      } : undefined, () => { published = true; });
    } finally {
      if (published && nextHead) state.head = nextHead;
      // Preserve even a rejected expiry observation. It must not revive after restart/rollback.
      if (observedTime > state.clockFloorMs) {
        state.clockFloorMs = observedTime;
        await this.#write(join(this.directory, 'authority.json'), JSON.stringify(state), false);
      }
    }
    await this.#fault?.('after-state-commit');
  }
  #snapshot(snapshot: unknown, recordHash: string): asserts snapshot is SyncSnapshot {
    check(keys(snapshot, SNAPSHOT_KEYS), 'SYNC_CORRUPT', 'Only encrypted sync snapshot records are accepted.');
    const record = snapshot as SyncSnapshot;
    const raw = JSON.stringify(record);
    check(Buffer.byteLength(raw) <= this.#maxBlobBytes, 'SYNC_TOO_LARGE', 'The encrypted sync blob exceeds its configured bound.');
    check(HASH.test(recordHash) && hash(raw) === recordHash && record.format === 'chausar.sync.v1' && textId(record.workspaceId) && textId(record.vaultId) && textId(record.deviceId) && textId(record.memberId) && textId(record.signerId) && integer(record.epoch, 1) && integer(record.fence, 1) && integer(record.revision) && integer(record.sequence, 1) && iso(record.createdAt) && (record.previousHash === null || (typeof record.previousHash === 'string' && HASH.test(record.previousHash))) && HASH.test(record.ciphertextDigest) && base64(record.signature, 'base64url', 64), 'SYNC_CORRUPT', 'The sync snapshot metadata or record hash is invalid.');
    check(record.workspaceId === this.workspaceId && record.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The encrypted blob belongs to another workspace or vault.');
    check(typeof record.ciphertextBase64 === 'string' && record.ciphertextBase64.length <= Math.ceil(MAX_BACKUP / 3) * 4, 'SYNC_TOO_LARGE', 'The encrypted backup exceeds 64 MiB.');
    check(base64(record.ciphertextBase64, 'base64') && hash(record.ciphertextBase64) === record.ciphertextDigest, 'SYNC_CORRUPT', 'The encrypted payload digest is invalid.');
    const bytes = Buffer.from(record.ciphertextBase64, 'base64');
    check(bytes.length <= MAX_BACKUP, 'SYNC_TOO_LARGE', 'The encrypted backup exceeds 64 MiB.');
    let backup: any; try { backup = JSON.parse(bytes.toString('utf8')); } catch { throw new ChausarError('SYNC_CORRUPT', 'The encrypted backup envelope is invalid.'); }
    const envelope = backup?.envelope;
    check(keys(backup, 'backupFormat,envelope') && backup.backupFormat === 'chausar.backup.v1' && keys(envelope, 'format,id,passphrase,recovery,revision,snapshot') && envelope.format === 'chausar.vault.v1' && envelope.id === record.vaultId && envelope.revision === record.revision, 'SYNC_CORRUPT', 'Sync only stores encrypted Vault.backup envelopes.');
    const cipher = (value: any, wrapper = false) => keys(value, 'data,nonce,tag') && base64(value.nonce, 'base64url', 12) && base64(value.tag, 'base64url', 16) && base64(value.data, 'base64url', wrapper ? 32 : undefined);
    const wrapper = (value: any) => keys(value, 'ciphertext,kdf,salt') && value.kdf === 'scrypt-32768-8-1' && base64(value.salt, 'base64url', 16) && cipher(value.ciphertext, true);
    check(cipher(envelope.snapshot) && wrapper(envelope.passphrase) && wrapper(envelope.recovery), 'SYNC_CORRUPT', 'The backup may contain only bounded encrypted data and wrapped keys.');
  }
  async #blob(recordHash: string): Promise<SyncSnapshot | null> {
    check(typeof recordHash === 'string' && HASH.test(recordHash), 'SYNC_CORRUPT', 'Use an exact SHA-256 sync record hash.');
    const raw = await this.#read(join(this.directory, 'blobs', `${recordHash}.json`), this.#maxBlobBytes);
    if (raw === null) return null;
    const snapshot = this.#parse(raw); this.#snapshot(snapshot, recordHash); return snapshot;
  }

  async getHead(): Promise<SyncHead | null> {
    return this.#locked(async () => structuredClone((await this.#load())?.head ?? null));
  }
  async acquireLease(input: { deviceId: string; memberId: string; epoch: number; now: string; ttlMs: number }): Promise<SyncLease | null> {
    const request = { ...input };
    check(textId(request.deviceId) && textId(request.memberId) && integer(request.epoch, 1) && iso(request.now) && integer(request.ttlMs, 1) && request.ttlMs <= this.#maxLeaseTtlMs, 'INVALID_SYNC_LEASE', 'Use a bounded lease for an exact writer identity.');
    return this.#locked(async () => {
      const state = await this.#load() ?? await this.#initialize(); const time = await this.#observeTime(state);
      if (state.lease && Date.parse(state.lease.expiresAt) > time && (state.lease.deviceId !== request.deviceId || state.lease.memberId !== request.memberId || state.lease.epoch !== request.epoch)) return null;
      check(state.fence < Number.MAX_SAFE_INTEGER && Number.isFinite(new Date(time + request.ttlMs).getTime()), 'SYNC_FENCE_EXHAUSTED', 'The sync writer authority cannot advance safely.');
      state.lease = { deviceId: request.deviceId, memberId: request.memberId, epoch: request.epoch, fence: state.fence + 1, expiresAt: new Date(time + request.ttlMs).toISOString(), token: randomUUID() };
      state.fence++; state.clockFloorMs = time; await this.#commit(state);
      return structuredClone(state.lease);
    });
  }
  async put(input: { lease: SyncLease; expectedHeadHash: string | null; recordHash: string; snapshot: SyncSnapshot; now: string }): Promise<SyncHead> {
    const request = structuredClone(input);
    check(iso(request.now), 'INVALID_SYNC_LEASE', 'Use an ISO timestamp for the publication receipt.');
    check(validLease(request.lease), 'FENCE_REJECTED', 'The exact issued writer lease is required.');
    return this.#locked(async () => {
      const state = await this.#load();
      check(state?.lease && sameLease(state.lease, request.lease), 'FENCE_REJECTED', 'The writer lease was not issued here or has been superseded.');
      const time = await this.#observeTime(state);
      check(Date.parse(state.lease.expiresAt) > time, 'FENCE_REJECTED', 'The writer lease expired on the trusted host clock.');
      check((state.head?.recordHash ?? null) === request.expectedHeadHash, 'SYNC_CAS_CONFLICT', 'The committed sync head changed.');
      this.#snapshot(request.snapshot, request.recordHash);
      const snapshot = request.snapshot;
      check(snapshot.fence === state.lease.fence && snapshot.deviceId === state.lease.deviceId && snapshot.memberId === state.lease.memberId && snapshot.epoch === state.lease.epoch, 'FENCE_REJECTED', 'The signed snapshot does not match the exact writer lease.');
      check(snapshot.previousHash === request.expectedHeadHash, 'SYNC_CAS_CONFLICT', 'The encrypted snapshot names a different predecessor.');
      check(snapshot.sequence === (state.head?.sequence ?? 0) + 1 && (!state.head || snapshot.revision > state.head.revision), 'SYNC_REPLAY', 'Snapshot revision and sequence must advance the committed head.');
      const raw = JSON.stringify(snapshot), path = join(this.directory, 'blobs', `${request.recordHash}.json`);
      try { await this.#write(path, raw, true); }
      catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        check(await this.#read(path, this.#maxBlobBytes) === raw, 'SYNC_CORRUPT', 'An immutable sync blob already exists with different bytes.');
      }
      await this.#fault?.('after-blob');
      const finalTime = await this.#observeTime(state);
      check(finalTime >= time, 'SYNC_CLOCK_REGRESSED', 'The trusted clock regressed during publication.');
      check(Date.parse(state.lease.expiresAt) > finalTime, 'FENCE_REJECTED', 'The lease expired before head publication.');
      const nextHead = headFor(request.recordHash, snapshot); await this.#commit(state, nextHead);
      return structuredClone(nextHead);
    });
  }
  async get(recordHash: string): Promise<SyncSnapshot | null> {
    check(typeof recordHash === 'string' && HASH.test(recordHash), 'SYNC_CORRUPT', 'Use an exact SHA-256 sync record hash.');
    return this.#locked(async () => (await this.#load()) ? this.#blob(recordHash) : null);
  }
}
