/**
 * EXPERIMENTAL: a Google Drive transport for the existing encrypted one-writer sync (sync.ts).
 *
 * It uses Drive API v3 with the `drive.file` scope only, so it sees just the folder and files this app created.
 * The access token comes from the caller's credential broker on every call and is never stored here.
 * Layout: one app-created folder holding one head file (JSON: identity, fence, lease and head) and one file
 * per encrypted record named `<recordHash>.json`. Records hold only encrypted Vault.backup envelopes.
 *
 * Drive has no compare-and-swap. Each lease or head change is written and then read back, and the fence,
 * revision and record hash must be ours or the call fails with SYNC_HEAD_MISMATCH. Two writers racing can
 * both believe they hold the lease within one request window, which is why sync stays single-writer with an
 * explicit hand-over between devices. Using it with real accounts needs Google's app verification for the
 * `drive.file` scope, which is a founder step; until then it is labelled experimental.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';
import { snapshotHash } from '../sync.ts';
import type { SyncHead, SyncLease, SyncSnapshot, SyncTransport } from '../sync.ts';
import type { Fetch, FetchReply } from './client.ts';

export const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const HEAD_FILE_NAME = 'chausar-sync-head.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_HEAD = 64 * 1024, MAX_RECORD = 96 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]{8,200}$/;
const HASH = /^[a-f0-9]{64}$/;
const SNAPSHOT_KEYS = 'ciphertextBase64,ciphertextDigest,createdAt,deviceId,epoch,fence,format,memberId,previousHash,revision,sequence,signature,signerId,vaultId,workspaceId';
type AccessToken = () => string | Promise<string>;
type DriveHeadFile = { format: 'chausar.drive-sync.v1'; workspaceId: string; vaultId: string; fence: number; lease: SyncLease | null; head: SyncHead | null };

const keys = (value: unknown, expected: string) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const textId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const sameLease = (a: SyncLease | null, b: SyncLease) => !!a && a.token === b.token && a.fence === b.fence && a.deviceId === b.deviceId && a.memberId === b.memberId && a.epoch === b.epoch && a.expiresAt === b.expiresAt;

async function call(fetcher: Fetch, token: AccessToken, method: string, url: string, body?: string, contentType?: string): Promise<FetchReply> {
  let bearer: string;
  try { bearer = await token(); } catch { throw new ChausarError('SYNC_ACCESS_DENIED', 'The Drive sign-in is not available.'); }
  check(typeof bearer === 'string' && /^[A-Za-z0-9._~+/-]{10,4096}=*$/.test(bearer), 'SYNC_ACCESS_DENIED', 'The Drive sign-in is not available.');
  let reply: FetchReply;
  try { reply = await fetcher(url, { method, headers: { authorization: `Bearer ${bearer}`, accept: 'application/json', ...(contentType ? { 'content-type': contentType } : {}) }, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(60000) }); }
  catch { throw new ChausarError('SYNC_UNREACHABLE', 'Google Drive could not be reached.'); }
  check(reply.status !== 401 && reply.status !== 403, 'SYNC_ACCESS_DENIED', 'Google Drive refused this app\'s access.');
  check(reply.ok, 'SYNC_TRANSPORT_FAILED', 'Google Drive refused the request.');
  return reply;
}
async function bounded(reply: FetchReply, limit: number): Promise<string> {
  const length = Number(reply.headers.get('content-length') ?? '0');
  check(!(length > limit), 'SYNC_TOO_LARGE', 'The Drive file exceeds its bounded size.');
  let text: string; try { text = await reply.text(); } catch { throw new ChausarError('SYNC_UNREACHABLE', 'Google Drive could not be reached.'); }
  check(Buffer.byteLength(text) <= limit, 'SYNC_TOO_LARGE', 'The Drive file exceeds its bounded size.');
  return text;
}
function parse(text: string, code = 'SYNC_STORE_CORRUPT'): any {
  try { return JSON.parse(text); } catch { throw new ChausarError(code, 'Google Drive returned something that is not a sync record.'); }
}
function multipart(metadata: Record<string, unknown>, content: string): { body: string; contentType: string } {
  const boundary = `chausar${randomBytes(18).toString('hex')}`;
  check(!content.includes(boundary), 'SYNC_TRANSPORT_FAILED', 'The upload boundary collided with its content.');
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}
async function createFile(fetcher: Fetch, token: AccessToken, name: string, parent: string | null, content: string | null): Promise<string> {
  const metadata = { name, ...(parent ? { parents: [parent] } : {}), ...(content === null ? { mimeType: FOLDER_MIME } : { mimeType: 'application/json' }) };
  const reply = content === null
    ? await call(fetcher, token, 'POST', `${DRIVE_FILES}?fields=id`, JSON.stringify(metadata), 'application/json')
    : await (async () => { const part = multipart(metadata, content); return call(fetcher, token, 'POST', `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, part.body, part.contentType); })();
  const created = parse(await bounded(reply, MAX_HEAD), 'SYNC_TRANSPORT_FAILED');
  check(keys(created, 'id') && FILE_ID.test(created.id), 'SYNC_TRANSPORT_FAILED', 'Google Drive did not return a file.');
  return created.id;
}

/** Creates the dedicated folder and its head file (needs only `drive.file`). Returns the two ids to keep. */
export async function createDriveSyncFolder(fetcher: Fetch, token: AccessToken, identity: { workspaceId: string; vaultId: string }, name = 'Chausar encrypted sync'): Promise<{ folderId: string; headFileId: string }> {
  check(textId(identity?.workspaceId) && textId(identity?.vaultId) && textId(name), 'SYNC_WORKSPACE_MISMATCH', 'Bind the Drive folder to exact workspace and vault identities.');
  const folderId = await createFile(fetcher, token, name, null, null);
  const head: DriveHeadFile = { format: 'chausar.drive-sync.v1', workspaceId: identity.workspaceId, vaultId: identity.vaultId, fence: 0, lease: null, head: null };
  const headFileId = await createFile(fetcher, token, HEAD_FILE_NAME, folderId, JSON.stringify(head));
  return { folderId, headFileId };
}

export type GoogleDriveSyncTransportOptions = {
  folderId: string; headFileId: string; workspaceId: string; vaultId: string;
  fetch: Fetch;
  /** Returns a current `drive.file` access token from the caller's credential broker. Never stored here. */
  accessToken: AccessToken;
  /** Trusted host clock; caller timestamps never decide lease expiry. */
  clock?: () => Date;
  maxLeaseTtlMs?: number;
};

export class GoogleDriveSyncTransport implements SyncTransport {
  readonly kind = 'google-drive';
  readonly experimental = true;
  readonly scope: { fileIds: string[]; broadAccess: false };
  readonly workspaceId: string;
  readonly vaultId: string;
  readonly #folderId: string;
  readonly #headFileId: string;
  readonly #fetch: Fetch;
  readonly #token: AccessToken;
  readonly #clock: () => Date;
  readonly #maxLeaseTtlMs: number;
  constructor(options: GoogleDriveSyncTransportOptions) {
    check(FILE_ID.test(options.folderId) && FILE_ID.test(options.headFileId) && options.folderId !== options.headFileId, 'SYNC_SCOPE_DENIED', 'Use the dedicated Drive folder and head file this app created.');
    check(textId(options.workspaceId) && textId(options.vaultId), 'SYNC_WORKSPACE_MISMATCH', 'Bind the transport to exact workspace and vault identities.');
    check(typeof options.fetch === 'function' && typeof options.accessToken === 'function', 'SYNC_ACCESS_DENIED', 'The Drive transport needs a request function and a token provider.');
    this.#folderId = options.folderId; this.#headFileId = options.headFileId; this.workspaceId = options.workspaceId; this.vaultId = options.vaultId;
    this.#fetch = options.fetch; this.#token = options.accessToken; this.#clock = options.clock ?? (() => new Date());
    this.#maxLeaseTtlMs = options.maxLeaseTtlMs ?? 120000;
    check(integer(this.#maxLeaseTtlMs, 1) && this.#maxLeaseTtlMs <= 120000, 'INVALID_SYNC_LEASE', 'The lease bound must be between 1 ms and 120 seconds.');
    this.scope = Object.freeze({ fileIds: [this.#folderId, this.#headFileId], broadAccess: false as const }) as { fileIds: string[]; broadAccess: false };
  }
  #time(): number {
    let ms: number; try { ms = this.#clock().getTime(); } catch { throw new ChausarError('SYNC_CLOCK_INVALID', 'The trusted sync clock is unavailable.'); }
    check(integer(ms), 'SYNC_CLOCK_INVALID', 'The trusted sync clock must return a valid current Date.');
    return ms;
  }
  async #readHead(): Promise<DriveHeadFile> {
    const reply = await call(this.#fetch, this.#token, 'GET', `${DRIVE_FILES}/${this.#headFileId}?alt=media`);
    const value = parse(await bounded(reply, MAX_HEAD));
    check(keys(value, 'fence,format,head,lease,vaultId,workspaceId') && value.format === 'chausar.drive-sync.v1' && integer(value.fence), 'SYNC_STORE_CORRUPT', 'The Drive sync head is invalid.');
    check(value.workspaceId === this.workspaceId && value.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The Drive folder belongs to another workspace or vault.');
    const lease = value.lease, head = value.head;
    check(lease === null ? value.fence === 0 && head === null : keys(lease, 'deviceId,epoch,expiresAt,fence,memberId,token') && textId(lease.deviceId) && textId(lease.memberId) && integer(lease.epoch, 1)
      && integer(lease.fence, 1) && lease.fence === value.fence && Number.isFinite(Date.parse(lease.expiresAt)) && textId(lease.token), 'SYNC_STORE_CORRUPT', 'The Drive writer lease is invalid.');
    check(head === null || (keys(head, 'fence,recordHash,revision,sequence,vaultId,workspaceId') && HASH.test(head.recordHash) && head.workspaceId === this.workspaceId && head.vaultId === this.vaultId
      && integer(head.revision) && integer(head.sequence, 1) && integer(head.fence, 1) && head.fence <= value.fence), 'SYNC_STORE_CORRUPT', 'The Drive sync head is invalid.');
    return value as DriveHeadFile;
  }
  async #writeHead(next: DriveHeadFile): Promise<void> {
    await call(this.#fetch, this.#token, 'PATCH', `${DRIVE_UPLOAD}/${this.#headFileId}?uploadType=media`, JSON.stringify(next), 'application/json');
  }
  async #find(recordHash: string): Promise<string | null> {
    check(HASH.test(recordHash), 'SYNC_CORRUPT', 'Use an exact SHA-256 sync record hash.');
    const q = `name = '${recordHash}.json' and '${this.#folderId}' in parents and trashed = false`;
    const reply = await call(this.#fetch, this.#token, 'GET', `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&spaces=drive&pageSize=10`);
    const listed = parse(await bounded(reply, MAX_HEAD), 'SYNC_TRANSPORT_FAILED');
    check(keys(listed, 'files') && Array.isArray(listed.files) && listed.files.every((f: any) => keys(f, 'id,name') && FILE_ID.test(f.id) && f.name === `${recordHash}.json`), 'SYNC_TRANSPORT_FAILED', 'Google Drive returned an unexpected file list.');
    check(listed.files.length <= 1, 'SYNC_STORE_CORRUPT', 'Two Drive files claim the same sync record.');
    return listed.files[0]?.id ?? null;
  }
  #snapshot(snapshot: unknown, recordHash: string): asserts snapshot is SyncSnapshot {
    check(keys(snapshot, SNAPSHOT_KEYS), 'SYNC_CORRUPT', 'Only encrypted sync snapshot records are accepted.');
    const record = snapshot as SyncSnapshot;
    check(HASH.test(recordHash) && snapshotHash(record) === recordHash && record.format === 'chausar.sync.v1' && integer(record.fence, 1) && integer(record.sequence, 1) && integer(record.revision)
      && (record.previousHash === null || HASH.test(record.previousHash)) && typeof record.ciphertextBase64 === 'string', 'SYNC_CORRUPT', 'The sync snapshot metadata or record hash is invalid.');
    check(record.workspaceId === this.workspaceId && record.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The encrypted record belongs to another workspace or vault.');
  }

  async getHead(): Promise<SyncHead | null> { return structuredClone((await this.#readHead()).head); }
  async acquireLease(input: { deviceId: string; memberId: string; epoch: number; now: string; ttlMs: number }): Promise<SyncLease | null> {
    check(textId(input?.deviceId) && textId(input.memberId) && integer(input.epoch, 1) && integer(input.ttlMs, 1) && input.ttlMs <= this.#maxLeaseTtlMs, 'INVALID_SYNC_LEASE', 'Use a bounded lease for an exact writer identity.');
    const state = await this.#readHead(), time = this.#time();
    if (state.lease && Date.parse(state.lease.expiresAt) > time && (state.lease.deviceId !== input.deviceId || state.lease.memberId !== input.memberId || state.lease.epoch !== input.epoch)) return null;
    check(state.fence < Number.MAX_SAFE_INTEGER, 'SYNC_FENCE_EXHAUSTED', 'The sync writer authority cannot advance safely.');
    const lease: SyncLease = { deviceId: input.deviceId, memberId: input.memberId, epoch: input.epoch, fence: state.fence + 1, expiresAt: new Date(time + input.ttlMs).toISOString(), token: randomUUID() };
    await this.#writeHead({ ...state, fence: lease.fence, lease });
    // No compare-and-swap: read back and keep the lease only if the write that landed is ours.
    const landed = await this.#readHead();
    return sameLease(landed.lease, lease) && landed.fence === lease.fence ? structuredClone(lease) : null;
  }
  async put(input: { lease: SyncLease; expectedHeadHash: string | null; recordHash: string; snapshot: SyncSnapshot; now: string }): Promise<SyncHead> {
    const request = structuredClone(input);
    const state = await this.#readHead(), time = this.#time();
    check(sameLease(state.lease, request.lease), 'FENCE_REJECTED', 'The writer lease was not issued here or has been superseded.');
    check(Date.parse(state.lease!.expiresAt) > time, 'FENCE_REJECTED', 'The writer lease expired on the trusted host clock.');
    check((state.head?.recordHash ?? null) === request.expectedHeadHash, 'SYNC_CAS_CONFLICT', 'The committed sync head changed.');
    this.#snapshot(request.snapshot, request.recordHash);
    const snapshot = request.snapshot;
    check(snapshot.fence === state.lease!.fence && snapshot.deviceId === state.lease!.deviceId && snapshot.memberId === state.lease!.memberId && snapshot.epoch === state.lease!.epoch, 'FENCE_REJECTED', 'The signed snapshot does not match the exact writer lease.');
    check(snapshot.previousHash === request.expectedHeadHash, 'SYNC_CAS_CONFLICT', 'The encrypted snapshot names a different predecessor.');
    check(snapshot.sequence === (state.head?.sequence ?? 0) + 1 && (!state.head || snapshot.revision > state.head.revision), 'SYNC_REPLAY', 'Snapshot revision and sequence must advance the committed head.');
    const raw = JSON.stringify(snapshot);
    check(Buffer.byteLength(raw) <= MAX_RECORD, 'SYNC_TOO_LARGE', 'The encrypted record exceeds its bound.');
    const existing = await this.#find(request.recordHash);
    if (existing) {
      const reply = await call(this.#fetch, this.#token, 'GET', `${DRIVE_FILES}/${existing}?alt=media`);
      check(await bounded(reply, MAX_RECORD) === raw, 'SYNC_CORRUPT', 'A sync record already exists with different bytes.');
    } else await createFile(this.#fetch, this.#token, `${request.recordHash}.json`, this.#folderId, raw);
    const before = await this.#readHead(), finalTime = this.#time();
    check(sameLease(before.lease, request.lease) && Date.parse(before.lease!.expiresAt) > finalTime, 'FENCE_REJECTED', 'The writer lease expired or moved before head publication.');
    check((before.head?.recordHash ?? null) === request.expectedHeadHash, 'SYNC_CAS_CONFLICT', 'The committed sync head changed.');
    const next: SyncHead = { recordHash: request.recordHash, workspaceId: snapshot.workspaceId, vaultId: snapshot.vaultId, revision: snapshot.revision, sequence: snapshot.sequence, fence: snapshot.fence };
    await this.#writeHead({ ...before, head: next });
    const landed = await this.#readHead();
    check(landed.head && landed.head.recordHash === next.recordHash && landed.head.fence === next.fence && landed.head.revision === next.revision && landed.head.sequence === next.sequence
      && sameLease(landed.lease, request.lease), 'SYNC_HEAD_MISMATCH', 'Another writer changed the Drive head at the same time.');
    return structuredClone(next);
  }
  async get(recordHash: string): Promise<SyncSnapshot | null> {
    const id = await this.#find(recordHash);
    if (!id) return null;
    const reply = await call(this.#fetch, this.#token, 'GET', `${DRIVE_FILES}/${id}?alt=media`);
    const snapshot = parse(await bounded(reply, MAX_RECORD), 'SYNC_CORRUPT');
    this.#snapshot(snapshot, recordHash);
    return snapshot;
  }
}
