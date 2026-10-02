import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { acquireProcessLock } from '../process-lock.ts';
import { PhoneError, isId, isOperationVersion, sameBinding } from './contracts.ts';
import type { PhoneErrorCode, RemoteRequest, RequestResult, SessionAuthority } from './contracts.ts';
import type { PhoneCustodyRecord, PhoneCustodyStorage, PhoneRequestIdentity } from './host-contracts.ts';

const FORMAT = 'chausar-phone-custody-v1';
const MAGIC = Buffer.from('CPHCUST1');
const HEADER_BYTES = 44;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_RECORDS = 1000;
const MAX_SESSION_RECORDS = 100;
const queues = new Map<string, Promise<void>>();
const ERROR_CODES = new Set<PhoneErrorCode>(['OFFLINE', 'VALIDATION_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'REQUEST_EXISTS', 'TRANSPORT_UNKNOWN', 'CACHE_INVALID']);
const fail = (code: PhoneErrorCode): never => { throw new PhoneError(code); };
function need(condition: unknown, code: PhoneErrorCode): asserts condition { if (!condition) fail(code); }
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validBinding(value: unknown): boolean {
  return exact(value, ['workspaceId', 'memberId', 'deviceId', 'epoch']) && isId(value.workspaceId) && isId(value.memberId)
    && isId(value.deviceId) && Number.isSafeInteger(value.epoch) && (value.epoch as number) > 0;
}
function validIdentity(value: unknown): value is PhoneRequestIdentity {
  if (!object(value) || !isId(value.requestId)) return false;
  if (value.kind === 'chat') return exact(value, ['requestId', 'kind']);
  return (value.kind === 'approval' || value.kind === 'upload') && exact(value, ['requestId', 'kind', 'target']) && isId(value.target);
}
function validScope(value: unknown): boolean {
  return exact(value, ['revision', 'operationVersion', 'sourceIds']) && isOperationVersion(value.revision)
    && isOperationVersion(value.operationVersion) && Array.isArray(value.sourceIds) && value.sourceIds.length <= 100
    && value.sourceIds.every(isId) && new Set(value.sourceIds).size === value.sourceIds.length;
}
function state(value: unknown, identity: PhoneRequestIdentity, code: PhoneErrorCode): RemoteRequest<RequestResult> {
  need(object(value) && value.requestId === identity.requestId, code);
  if (value.status === 'unknown' || value.status === 'pending' || value.status === 'cancelled') {
    need(exact(value, ['status', 'requestId']), code);
    return { status: value.status, requestId: identity.requestId };
  }
  if (value.status === 'failed') {
    need(exact(value, ['status', 'requestId', 'code']) && ERROR_CODES.has(value.code as PhoneErrorCode), code);
    return { status: 'failed', requestId: identity.requestId, code: value.code as PhoneErrorCode };
  }
  need(value.status === 'succeeded' && exact(value, ['status', 'requestId', 'result']), code);
  const result = value.result;
  let safe: RequestResult;
  if (identity.kind === 'chat') {
    need(exact(result, ['conversationId', 'text', 'receiptIds']) && isId(result.conversationId)
      && typeof result.text === 'string' && result.text.length <= 64000 && Array.isArray(result.receiptIds)
      && result.receiptIds.length <= 100 && result.receiptIds.every(isId), code);
    safe = { conversationId: result.conversationId, text: result.text, receiptIds: [...result.receiptIds] };
  } else if (identity.kind === 'upload') {
    need(exact(result, ['uploadId', 'sourceId', 'status', 'sourceTainted']) && result.uploadId === identity.target
      && isId(result.sourceId) && result.status === 'awaiting-confirmation' && result.sourceTainted === true, code);
    safe = { uploadId: identity.target!, sourceId: result.sourceId, status: 'awaiting-confirmation', sourceTainted: true };
  } else {
    need(exact(result, ['approvalId', 'actionId', 'decision', 'decidedAt']) && result.approvalId === identity.target
      && isId(result.actionId) && (result.decision === 'approved' || result.decision === 'rejected') && iso(result.decidedAt), code);
    safe = { approvalId: identity.target!, actionId: result.actionId, decision: result.decision, decidedAt: result.decidedAt };
  }
  return { status: 'succeeded', requestId: identity.requestId, result: safe };
}
function record(value: unknown, code: PhoneErrorCode): PhoneCustodyRecord {
  need(exact(value, ['identity', 'binding', 'sessionId', 'operationId', 'inputDigest', 'scope', 'createdAt', 'expiresAt', 'state'])
    && validIdentity(value.identity) && validBinding(value.binding) && isId(value.sessionId) && isId(value.operationId)
    && digest(value.inputDigest) && validScope(value.scope) && iso(value.createdAt) && iso(value.expiresAt)
    && Date.parse(value.expiresAt) > Date.parse(value.createdAt), code);
  const safe = structuredClone(value) as unknown as PhoneCustodyRecord;
  safe.state = state(value.state, safe.identity, code);
  need(Buffer.byteLength(JSON.stringify(safe), 'utf8') <= MAX_RECORD_BYTES, code);
  return safe;
}
function ownerKey(value: Pick<PhoneCustodyRecord, 'binding' | 'sessionId'>): string {
  const b = value.binding;
  return JSON.stringify([b.workspaceId, b.memberId, b.deviceId, b.epoch, value.sessionId]);
}
function validateRecords(values: unknown): asserts values is PhoneCustodyRecord[] {
  need(Array.isArray(values) && values.length <= MAX_RECORDS, 'CACHE_INVALID');
  const identities = new Set<string>(), operations = new Set<string>(), sessions = new Map<string, number>();
  for (const value of values) {
    const safe = record(value, 'CACHE_INVALID'), owner = ownerKey(safe), identity = JSON.stringify([owner, safe.identity.requestId]);
    const count = (sessions.get(owner) ?? 0) + 1;
    need(!identities.has(identity) && !operations.has(safe.operationId) && count <= MAX_SESSION_RECORDS, 'CACHE_INVALID');
    identities.add(identity); operations.add(safe.operationId); sessions.set(owner, count);
  }
}
function authority(value: SessionAuthority): void { need(object(value) && validBinding(value.binding) && isId(value.sessionId), 'INVALID_REQUEST'); }
const belongs = (r: PhoneCustodyRecord, a: SessionAuthority) => r.sessionId === a.sessionId && sameBinding(r.binding, a.binding);
const terminal = (s: RemoteRequest<RequestResult>) => s.status === 'succeeded' || s.status === 'failed' || s.status === 'cancelled';
const equalScope = (a: PhoneCustodyRecord['scope'], b: PhoneCustodyRecord['scope']) => a.revision === b.revision
  && a.operationVersion === b.operationVersion && JSON.stringify(a.sourceIds) === JSON.stringify(b.sourceIds);

/** Request identity/result custody is not authorization. The host must check current
 * authority before every access and dispatch; retained inputs are never replayed. */
export class PhoneRequestCustody {
  private readonly storage: PhoneCustodyStorage;
  constructor(storage: PhoneCustodyStorage) { this.storage = storage; }

  async reserve(input: PhoneCustodyRecord): Promise<{ record: PhoneCustodyRecord; dispatch: boolean }> {
    const safe = record(input, 'INVALID_REQUEST');
    need(safe.state.status === 'unknown', 'INVALID_REQUEST');
    return this.storage.transaction(records => {
      validateRecords(records);
      const existing = records.find(r => r.sessionId === safe.sessionId && sameBinding(r.binding, safe.binding) && r.identity.requestId === safe.identity.requestId);
      if (existing) {
        need(existing.identity.kind === safe.identity.kind && existing.identity.target === safe.identity.target
          && existing.inputDigest === safe.inputDigest && equalScope(existing.scope, safe.scope),
        existing.identity.kind === 'approval' && safe.identity.kind === 'approval' ? 'PREVIEW_CHANGED' : 'REQUEST_EXISTS');
        return { record: structuredClone(existing), dispatch: false };
      }
      need(records.length < MAX_RECORDS && records.filter(r => ownerKey(r) === ownerKey(safe)).length < MAX_SESSION_RECORDS
        && !records.some(r => r.operationId === safe.operationId), 'REQUEST_EXISTS');
      records.push(structuredClone(safe));
      return { record: structuredClone(safe), dispatch: true };
    });
  }

  async get(owner: SessionAuthority, requestId: string): Promise<PhoneCustodyRecord | undefined> {
    authority(owner); need(isId(requestId), 'INVALID_REQUEST');
    return this.storage.transaction(records => {
      validateRecords(records);
      const found = records.find(r => belongs(r, owner) && r.identity.requestId === requestId);
      return found ? structuredClone(found) : undefined;
    });
  }

  async list(owner: SessionAuthority): Promise<PhoneCustodyRecord[]> {
    authority(owner);
    return this.storage.transaction(records => {
      validateRecords(records);
      return records.filter(r => belongs(r, owner)).map(r => structuredClone(r));
    });
  }

  async settle(owner: SessionAuthority, requestId: string, outcome: RemoteRequest<RequestResult>): Promise<PhoneCustodyRecord> {
    authority(owner); need(isId(requestId), 'INVALID_REQUEST');
    return this.storage.transaction(records => {
      validateRecords(records);
      const found = records.find(r => belongs(r, owner) && r.identity.requestId === requestId);
      need(found, 'INVALID_REQUEST');
      const incoming = state(outcome, found.identity, 'INVALID_RESPONSE');
      if (terminal(found.state)) {
        if (terminal(incoming)) need(JSON.stringify(state(found.state, found.identity, 'CACHE_INVALID')) === JSON.stringify(incoming), 'INVALID_RESPONSE');
        return structuredClone(found);
      }
      found.state = incoming;
      record(found, 'INVALID_RESPONSE');
      return structuredClone(found);
    });
  }
}

export type EncryptedFilePhoneCustodyOptions = { directory: string; custodyId: string; key: Uint8Array };
type Snapshot = { revision: number; records: PhoneCustodyRecord[]; bytes?: Buffer };

async function safeDirectory(directory: string): Promise<void> {
  for (let current = directory; ; current = dirname(current)) {
    const stat = await lstat(current);
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'CACHE_INVALID');
    if (current === dirname(current)) break;
  }
  const actual = await realpath(directory);
  need(process.platform === 'win32' ? actual.toLowerCase() === directory.toLowerCase() : actual === directory, 'CACHE_INVALID');
}
async function syncDirectory(directory: string): Promise<void> {
  let file;
  try { file = await open(directory, constants.O_RDONLY); await file.sync(); }
  catch (error: any) {
    // Windows does not expose a portable Node directory-fsync operation. File
    // fsync and same-directory atomic rename are executed; power-loss directory
    // durability on Windows remains a separate native/filesystem qualification.
    if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error.code)) throw error;
  } finally { await file?.close(); }
}
async function safeRead(path: string): Promise<Buffer | undefined> {
  let before;
  try { before = await lstat(path); } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size >= HEADER_BYTES
    && before.size <= MAX_SNAPSHOT_BYTES + HEADER_BYTES, 'CACHE_INVALID');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await file.stat();
    need(current.isFile() && current.nlink === 1 && current.dev === before.dev && current.ino === before.ino
      && current.size === before.size, 'CACHE_INVALID');
    const bytes = Buffer.alloc(current.size + 1), read = await file.read(bytes, 0, bytes.length, 0);
    need(read.bytesRead === current.size, 'CACHE_INVALID');
    const after = await lstat(path);
    need(after.isFile() && !after.isSymbolicLink() && after.dev === current.dev && after.ino === current.ino
      && after.size === current.size && after.mtimeMs === current.mtimeMs, 'CACHE_INVALID');
    return bytes.subarray(0, read.bytesRead);
  } finally { await file.close(); }
}

/** Dedicated encrypted durable host custody. Provision the directory and key
 * externally; this adapter never invents session authority or stores credentials,
 * approval tokens, questions, or replayable operation bodies. No expiry eviction:
 * dropping an admitted identity would allow dispatching it twice.
 * Cooperating processes use the existing conservative process lock; competing live
 * writers fail closed. A supplied key plus custodyId is not an anti-rollback anchor. */
export class EncryptedFilePhoneCustodyStorage implements PhoneCustodyStorage {
  private readonly directory: string;
  private readonly custodyId: string;
  private readonly key: Buffer;
  private readonly path: string;
  private readonly queueKey: string;

  constructor(options: EncryptedFilePhoneCustodyOptions) {
    need(object(options) && typeof options.directory === 'string' && isAbsolute(options.directory)
      && !options.directory.startsWith('\\\\') && isId(options.custodyId)
      && options.key instanceof Uint8Array && options.key.byteLength === 32, 'CACHE_INVALID');
    this.directory = resolve(options.directory); this.custodyId = options.custodyId; this.key = Buffer.from(options.key);
    const name = createHash('sha256').update(JSON.stringify([FORMAT, this.custodyId])).digest('hex');
    this.path = join(this.directory, `${name}.custody`);
    this.queueKey = process.platform === 'win32' ? this.path.toLowerCase() : this.path;
  }

  async transaction<T>(work: (records: PhoneCustodyRecord[]) => T): Promise<T> {
    const previous = queues.get(this.queueKey) ?? Promise.resolve();
    const pending = previous.then(async () => {
      let lock;
      try {
        await safeDirectory(this.directory);
        lock = await acquireProcessLock(`${this.path}.lock`, { busyCode: 'CACHE_INVALID', changedCode: 'CACHE_INVALID', unsafeCode: 'CACHE_INVALID' });
        await safeDirectory(this.directory);
        const snapshot = await this.read();
        const before = JSON.stringify(snapshot.records), result = work(snapshot.records);
        if (result && typeof (result as any).then === 'function') {
          // Reject async work without allowing its private rejection to escape as
          // an unhandled process error. The synchronous transaction is rolled back.
          void Promise.resolve(result).catch(() => {});
          fail('CACHE_INVALID');
        }
        validateRecords(snapshot.records);
        if (JSON.stringify(snapshot.records) !== before) await this.write(snapshot);
        return result;
      } catch (error) {
        if (error instanceof PhoneError) throw error;
        return fail('CACHE_INVALID');
      } finally {
        if (lock) try { await lock.release(); } catch { fail('CACHE_INVALID'); }
      }
    });
    const tail = pending.then(() => {}, () => {});
    queues.set(this.queueKey, tail);
    void tail.then(() => { if (queues.get(this.queueKey) === tail) queues.delete(this.queueKey); });
    return pending;
  }

  private aad(revision: number): Buffer { return Buffer.from(JSON.stringify([FORMAT, this.custodyId, revision])); }

  private async read(): Promise<Snapshot> {
    const bytes = await safeRead(this.path);
    if (!bytes) return { revision: 0, records: [] };
    need(bytes.subarray(0, MAGIC.length).equals(MAGIC), 'CACHE_INVALID');
    const number = bytes.readBigUInt64BE(8);
    need(number > 0n && number <= BigInt(Number.MAX_SAFE_INTEGER), 'CACHE_INVALID');
    const revision = Number(number), decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(16, 28));
    decipher.setAAD(this.aad(revision)); decipher.setAuthTag(bytes.subarray(28, HEADER_BYTES));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]);
    need(plaintext.length <= MAX_SNAPSHOT_BYTES, 'CACHE_INVALID');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext), parsed: unknown = JSON.parse(text);
    need(exact(parsed, ['format', 'custodyId', 'revision', 'records']) && parsed.format === FORMAT
      && parsed.custodyId === this.custodyId && parsed.revision === revision && JSON.stringify(parsed) === text, 'CACHE_INVALID');
    validateRecords(parsed.records);
    return { revision, records: parsed.records, bytes };
  }

  private async write(snapshot: Snapshot): Promise<void> {
    need(snapshot.revision < Number.MAX_SAFE_INTEGER, 'CACHE_INVALID');
    const revision = snapshot.revision + 1;
    const plaintext = Buffer.from(JSON.stringify({ format: FORMAT, custodyId: this.custodyId, revision, records: snapshot.records }));
    need(plaintext.length <= MAX_SNAPSHOT_BYTES, 'CACHE_INVALID');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.aad(revision));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]), header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header); header.writeBigUInt64BE(BigInt(revision), 8); nonce.copy(header, 16); cipher.getAuthTag().copy(header, 28);
    const bytes = Buffer.concat([header, encrypted]);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    try {
      await file.writeFile(bytes); await file.sync();
      const written = await file.stat();
      need(written.isFile() && written.nlink === 1 && written.size === bytes.length, 'CACHE_INVALID');
      await safeDirectory(this.directory);
      const current = await safeRead(this.path);
      need(snapshot.bytes ? !!current && current.equals(snapshot.bytes) : !current, 'CACHE_INVALID');
      const source = await lstat(temporary);
      need(source.isFile() && !source.isSymbolicLink() && source.nlink === 1 && source.dev === written.dev
        && source.ino === written.ino && source.size === written.size && (await safeRead(temporary))?.equals(bytes), 'CACHE_INVALID');
      await rename(temporary, this.path);
      const published = await lstat(this.path);
      need(published.isFile() && !published.isSymbolicLink() && published.nlink === 1
        && published.dev === written.dev && published.ino === written.ino && (await safeRead(this.path))?.equals(bytes), 'CACHE_INVALID');
      await syncDirectory(this.directory);
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    finally { await file.close(); }
  }
}
