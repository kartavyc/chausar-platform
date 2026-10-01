import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { authorize, check, ChausarError, hash } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { assertSourceAccess } from './trust.ts';

export type SyncWriterState = { state: State; vaultId: string; context?: Context };
export type SyncWriterReview = {
  expectedFence: number;
  expectedStateDigest: string;
  deviceId: string;
  memberId: string;
  epoch: number;
  expiresAt: string;
  /** Explicit review explanation. Only its digest is persisted. */
  reason: string;
};
export type SyncWriterStatus = {
  readonly: boolean;
  reason: string | null;
  fence: number;
  /** Exact enrolled/admitted business/auth state, excluding sync bookkeeping and revision. */
  stateDigest: string;
  localStateDigest: string;
  grant: null | { deviceId: string; memberId: string; epoch: number; expiresAt: string };
  qualification: 'local-cooperative-process-only';
};
export type SyncWriterWorkResult<T> = {
  result: T;
  committedState: State;
  /** Trusted, synchronous, nonthrowing volatile-configuration restoration only. Never undo a durable Vault commit. */
  rollback?: () => void;
};
export interface SyncWriterAdmission {
  readonly deviceId: string;
  readonly workspaceId: string;
  readonly vaultId: string;
  status(input: SyncWriterState): Promise<SyncWriterStatus>;
  review(context: Context, state: State, vaultId: string, input: SyncWriterReview): Promise<SyncWriterStatus>;
  /** Caller must invoke assertCurrent immediately before its authority commit. */
  run<T>(input: SyncWriterState, work: (assertCurrent: () => void) => Promise<SyncWriterWorkResult<T>>): Promise<T>;
}
export type FileSyncWriterAdmissionOptions = {
  /** Existing dedicated local directory, distinct from the transport directory. */
  directory: string;
  workspaceId: string;
  vaultId: string;
  deviceId: string;
  /** Trusted host clock; caller timestamps never advance grant authority. */
  clock?: () => Date;
};
type Identity = { format: 'chausar.file-sync-writer.v1'; controlId: string; workspaceId: string; vaultId: string };
type Grant = {
  deviceId: string; memberId: string; epoch: number; expiresAt: string;
  reviewedAt: string; reviewerId: string; reviewerEpoch: number; reasonDigest: string;
};
type Authority = Identity & { fence: number; clockFloorMs: number; stateDigest: string; grant: Grant | null };
const MAX_RECORD_BYTES = 8192, MAX_GRANT_MS = 120000;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keys = (value: unknown, expected: string) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const textId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
function iso(value: unknown): value is string {
  return typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Same exclusion as SyncService's preview fingerprint; every business/auth field remains. */
export function writerStateDigest(state: State): string {
  return hash({ ...state, revision: 0, modelReceipts: state.modelReceipts.filter(r => !String(r.kind).startsWith('sync-')), activity: state.activity.filter(a => !String(a.event).startsWith('sync.')) });
}
function stateStore(state: State): StateStore {
  return { read: () => state, update: async () => { throw new ChausarError('SYNC_WRITER_STORE_CORRUPT', 'Writer admission does not mutate a workspace.'); } };
}
function fullAdmin(state: State, context: Context): void {
  const member = authorize(stateStore(state), context, 'admin');
  check(member.branches.includes('*'), 'SYNC_SCOPE_DENIED', 'Full-vault writer admission requires every branch.');
  assertSourceAccess(state, context, [...new Set(state.facts.map(f => f.sourceId))]);
}
function validGrant(value: unknown): value is Grant {
  if (!keys(value, 'deviceId,epoch,expiresAt,memberId,reasonDigest,reviewedAt,reviewerEpoch,reviewerId')) return false;
  const grant = value as Grant;
  return textId(grant.deviceId) && textId(grant.memberId) && integer(grant.epoch, 1) && iso(grant.expiresAt) && iso(grant.reviewedAt) &&
    Date.parse(grant.expiresAt) > Date.parse(grant.reviewedAt) && Date.parse(grant.expiresAt) - Date.parse(grant.reviewedAt) <= MAX_GRANT_MS &&
    textId(grant.reviewerId) && integer(grant.reviewerEpoch, 1) && HASH.test(grant.reasonDigest);
}

/**
 * Independent reviewed writer authority for cooperating local processes. Publication leases
 * neither grant nor renew it. One process lock covers the complete caller transaction, then
 * an atomic record advances the last admitted state digest without rotating the reviewed fence.
 * Initial enrollment persists a read-only fence-zero seed before publishing any reviewed grant.
 * Known first-review expiry preserves that seed for a new explicit exact-state review; it does
 * not reset identity, digest or clock. A missing authority after identity publication still
 * refuses because an interrupted pair publication cannot prove its former fencing state.
 * A crash after the vault commit but before this record commits leaves a digest conflict;
 * there is no inferred acknowledgment, renewal, takeover, reset or retry.
 * This requires one real local directory and a trusted host clock across restart. The clock
 * floor catches regression behind persisted observations; a kill can precede its persistence.
 * It does not qualify cloud folders, remote hosts, power-loss durability or OS security.
 */
export class FileSyncWriterAdmission implements SyncWriterAdmission {
  readonly directory: string;
  readonly workspaceId: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly #clock: () => Date;
  constructor(options: FileSyncWriterAdmissionOptions) {
    check(typeof options.directory === 'string' && isAbsolute(options.directory) && resolve(options.directory) !== parse(resolve(options.directory)).root, 'SYNC_UNSAFE_PATH', 'Use an existing non-root dedicated local writer directory.');
    check(textId(options.workspaceId) && textId(options.vaultId) && textId(options.deviceId), 'SYNC_WORKSPACE_MISMATCH', 'Bind writer admission to exact workspace, vault and device identities.');
    this.directory = resolve(options.directory); this.workspaceId = options.workspaceId; this.vaultId = options.vaultId; this.deviceId = options.deviceId;
    this.#clock = options.clock ?? (() => new Date());
  }
  async #directory(): Promise<void> {
    for (let current = this.directory; ; current = dirname(current)) {
      const stat = await lstat(current);
      check(stat.isDirectory() && !stat.isSymbolicLink(), 'SYNC_UNSAFE_PATH', 'Writer control paths must be real local directories.');
      if (current === dirname(current)) return;
    }
  }
  #state(input: SyncWriterState): void {
    check(input.state?.workspace?.id === this.workspaceId && input.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'Writer admission belongs to another workspace or vault.');
    check(integer(input.state.revision) && Array.isArray(input.state.members) && Array.isArray(input.state.facts) && Array.isArray(input.state.modelReceipts) && Array.isArray(input.state.activity), 'SYNC_WRITER_STORE_CORRUPT', 'The writer requires a valid current authority state.');
  }
  async #read(path: string): Promise<string | null> {
    let before; try { before = await lstat(path); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    check(before.isFile() && !before.isSymbolicLink(), 'SYNC_UNSAFE_PATH', 'Writer records must be regular files.');
    check(before.size > 0 && before.size <= MAX_RECORD_BYTES, 'SYNC_WRITER_STORE_CORRUPT', 'The writer record is empty or exceeds its bound.');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await file.stat();
      check(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size > 0 && stat.size <= MAX_RECORD_BYTES, 'SYNC_UNSAFE_PATH', 'The writer record changed while opening it.');
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const result = await file.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
      check(length === stat.size, 'SYNC_WRITER_STORE_CORRUPT', 'The writer record changed while reading it.');
      const raw = bytes.subarray(0, length).toString('utf8');
      check(Buffer.from(raw).equals(bytes.subarray(0, length)), 'SYNC_WRITER_STORE_CORRUPT', 'The writer record is not valid UTF-8.');
      return raw;
    } finally { await file.close(); }
  }
  #parse(raw: string): any {
    let value; try { value = JSON.parse(raw); } catch { throw new ChausarError('SYNC_WRITER_STORE_CORRUPT', 'The writer authority contains an invalid record.'); }
    check(JSON.stringify(value) === raw, 'SYNC_WRITER_STORE_CORRUPT', 'The writer record is not canonical JSON.');
    return value;
  }
  async #load(): Promise<Authority | null> {
    const identityRaw = await this.#read(join(this.directory, 'writer-identity.json'));
    if (identityRaw === null) {
      const entries = await readdir(this.directory);
      check(entries.every(name => name === '.admission.lock' || /^\.admission\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)$/.test(name)), 'SYNC_WRITER_STORE_CORRUPT', 'An uninitialized writer directory must be empty; missing authority cannot be reset.');
      return null;
    }
    const identity = this.#parse(identityRaw) as Identity;
    check(keys(identity, 'controlId,format,vaultId,workspaceId') && identity.format === 'chausar.file-sync-writer.v1' && UUID.test(identity.controlId) && textId(identity.workspaceId) && textId(identity.vaultId), 'SYNC_WRITER_STORE_CORRUPT', 'The writer identity record is invalid.');
    check(identity.workspaceId === this.workspaceId && identity.vaultId === this.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The writer directory belongs to another workspace or vault.');
    const raw = await this.#read(join(this.directory, 'writer-authority.json'));
    check(raw !== null, 'SYNC_WRITER_STORE_CORRUPT', 'The persistent writer authority is missing; do not reset fencing.');
    const authority = this.#parse(raw) as Authority;
    check(keys(authority, 'clockFloorMs,controlId,fence,format,grant,stateDigest,vaultId,workspaceId') && authority.format === identity.format && authority.controlId === identity.controlId && authority.workspaceId === identity.workspaceId && authority.vaultId === identity.vaultId && integer(authority.fence) && integer(authority.clockFloorMs) && Number.isFinite(new Date(authority.clockFloorMs).getTime()) && HASH.test(authority.stateDigest) &&
      ((authority.fence === 0 && authority.grant === null) || (authority.fence > 0 && validGrant(authority.grant))), 'SYNC_WRITER_STORE_CORRUPT', 'The persistent reviewed writer authority is invalid.');
    check(authority.grant === null || authority.clockFloorMs >= Date.parse(authority.grant.reviewedAt), 'SYNC_WRITER_STORE_CORRUPT', 'The writer clock floor predates its review.');
    return authority;
  }
  async #syncDirectory(): Promise<void> {
    let file; try { file = await open(this.directory, constants.O_RDONLY); await file.sync(); }
    catch (error: any) { if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error.code)) throw error; }
    finally { await file?.close(); }
  }
  async #write(path: string, raw: string, immutable = false, beforePublish?: () => void): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(raw); await file.sync(); await file.close(); beforePublish?.();
      if (immutable) { await link(temporary, path); await unlink(temporary); } else await rename(temporary, path);
      await this.#syncDirectory();
    } catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  }
  async #locked<T>(action: () => Promise<T>): Promise<T> {
    await this.#directory();
    const lock = await acquireProcessLock(join(this.directory, '.admission.lock'), { busyCode: 'SYNC_WRITER_BUSY', busyMessage: 'Another local process holds or may hold writer admission.', changedCode: 'SYNC_WRITER_LOCK_CHANGED', unsafeCode: 'SYNC_UNSAFE_PATH' });
    try { return await action(); } finally { await lock.release(); }
  }
  #time(floor: number): number {
    let time: Date; try { time = this.#clock(); } catch { throw new ChausarError('SYNC_CLOCK_INVALID', 'The trusted writer clock is unavailable.'); }
    const ms = time instanceof Date ? time.getTime() : NaN;
    check(integer(ms) && Number.isFinite(new Date(ms).getTime()), 'SYNC_CLOCK_INVALID', 'The trusted writer clock must return a valid current Date.');
    check(ms >= floor, 'SYNC_CLOCK_REGRESSED', 'The trusted writer clock regressed behind persistent authority.');
    return ms;
  }
  async #observe(authority: Authority): Promise<number> {
    const time = this.#time(authority.clockFloorMs);
    if (time > authority.clockFloorMs) { authority.clockFloorMs = time; await this.#write(join(this.directory, 'writer-authority.json'), JSON.stringify(authority)); }
    return time;
  }
  async #retainObservedFloor(observedFloor: number): Promise<void> {
    // Read back the actual record after a failed/ambiguous write. Never restore an older
    // grant, fence or digest merely because the atomic publication acknowledgment failed.
    const durable = await this.#load();
    if (durable && observedFloor > durable.clockFloorMs) {
      durable.clockFloorMs = observedFloor;
      await this.#write(join(this.directory, 'writer-authority.json'), JSON.stringify(durable));
    }
  }
  #reason(state: State, authority: Authority, digest: string, time: number): string | null {
    if (authority.stateDigest !== digest) return 'SYNC_WRITER_STATE_CONFLICT';
    if (authority.grant === null) return 'SYNC_WRITER_REVIEW_REQUIRED';
    const grant = authority.grant;
    if (grant.deviceId !== this.deviceId) return 'SYNC_WRITER_DEVICE_MISMATCH';
    if (Date.parse(grant.expiresAt) <= time) return 'SYNC_WRITER_EXPIRED';
    const member = state.members.find(m => m.id === grant.memberId);
    if (!member?.active || member.epoch !== grant.epoch || !['owner', 'cofounder'].includes(member.role)) return 'SYNC_WRITER_REVOKED';
    try { fullAdmin(state, { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' }); }
    catch (error) { if (error instanceof ChausarError) return 'SYNC_WRITER_REVOKED'; throw error; }
    return null;
  }
  #actorReason(state: State, authority: Authority, context?: Context): string | null {
    if (authority.grant === null) return 'SYNC_WRITER_REVIEW_REQUIRED';
    if (!context) return null; // Pure trusted-host fixture use; Engine always supplies its actual actor.
    const member = state.members.find(m => m.id === context.memberId);
    return context.channel === 'desktop' && context.sourceTainted !== true && context.memberId === authority.grant.memberId &&
      context.epoch === authority.grant.epoch && member?.active && member.epoch === context.epoch && member.role === context.role && ['owner', 'cofounder'].includes(member.role)
      ? null : 'SYNC_WRITER_ACTOR_MISMATCH';
  }
  #status(state: State, authority: Authority | null, time: number, context?: Context): SyncWriterStatus {
    const localStateDigest = writerStateDigest(state), reason = authority ? this.#reason(state, authority, localStateDigest, time) ?? this.#actorReason(state, authority, context) : 'SYNC_WRITER_REVIEW_REQUIRED';
    return { readonly: reason !== null, reason, fence: authority?.fence ?? 0, stateDigest: authority?.stateDigest ?? localStateDigest, localStateDigest,
      grant: authority?.grant ? { deviceId: authority.grant.deviceId, memberId: authority.grant.memberId, epoch: authority.grant.epoch, expiresAt: authority.grant.expiresAt } : null, qualification: 'local-cooperative-process-only' };
  }
  async status(input: SyncWriterState): Promise<SyncWriterStatus> {
    this.#state(input);
    return this.#locked(async () => { const authority = await this.#load(); const time = authority ? await this.#observe(authority) : this.#time(0); return this.#status(input.state, authority, time, input.context); });
  }
  async review(context: Context, state: State, vaultId: string, input: SyncWriterReview): Promise<SyncWriterStatus> {
    this.#state({ state, vaultId });
    check(context.channel === 'desktop' && context.sourceTainted !== true, 'APP_APPROVAL_REQUIRED', 'Review writer authority in an untainted desktop owner session.');
    fullAdmin(state, context);
    check(keys(input, 'deviceId,epoch,expectedFence,expectedStateDigest,expiresAt,memberId,reason') && integer(input.expectedFence) && HASH.test(input.expectedStateDigest) && textId(input.deviceId) && textId(input.memberId) && integer(input.epoch, 1) && iso(input.expiresAt) && typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 1000, 'INVALID_SYNC_WRITER_REVIEW', 'Review the exact fence, state digest, current writer identity, bounded expiry and a reason.');
    const target = state.members.find(m => m.id === input.memberId);
    check(target?.active && target.epoch === input.epoch && ['owner', 'cofounder'].includes(target.role), 'ACCESS_REVOKED', 'The reviewed writer must be a current workspace administrator.');
    fullAdmin(state, { memberId: target.id, role: target.role, epoch: target.epoch, channel: 'desktop' });
    return this.#locked(async () => {
      const authority = await this.#load(), time = authority ? await this.#observe(authority) : this.#time(0), digest = writerStateDigest(state);
      check(input.expectedFence === (authority?.fence ?? 0), 'SYNC_WRITER_CAS_CONFLICT', 'Writer authority changed after review.');
      check(input.expectedStateDigest === digest && (!authority || authority.stateDigest === digest), 'SYNC_WRITER_STATE_CONFLICT', 'The current workspace differs from the last admitted writer state. Preserve both copies for explicit recovery.');
      check(Date.parse(input.expiresAt) > time && Date.parse(input.expiresAt) - time <= MAX_GRANT_MS, 'INVALID_SYNC_WRITER_REVIEW', 'Explicit writer expiry must be in the future and within 120 seconds.');
      check(integer((authority?.fence ?? 0) + 1, 1), 'SYNC_WRITER_STORE_CORRUPT', 'The writer fence cannot advance safely.');
      const identity: Identity = authority ? { format: authority.format, controlId: authority.controlId, workspaceId: authority.workspaceId, vaultId: authority.vaultId } : { format: 'chausar.file-sync-writer.v1', controlId: randomUUID(), workspaceId: this.workspaceId, vaultId: this.vaultId };
      const next: Authority = { ...identity, fence: (authority?.fence ?? 0) + 1, clockFloorMs: time, stateDigest: digest, grant: { deviceId: input.deviceId, memberId: input.memberId, epoch: input.epoch, expiresAt: input.expiresAt, reviewedAt: new Date(time).toISOString(), reviewerId: context.memberId, reviewerEpoch: context.epoch, reasonDigest: hash(input.reason) } };
      let observedFloor = time;
      try {
        if (!authority) {
          await this.#write(join(this.directory, 'writer-identity.json'), JSON.stringify(identity), true);
          // Persist a complete, non-writing baseline before checking the grant publication
          // deadline. A refused first grant must not leave only an identity marker behind.
          const seed: Authority = { ...identity, fence: 0, clockFloorMs: time, stateDigest: digest, grant: null };
          await this.#write(join(this.directory, 'writer-authority.json'), JSON.stringify(seed), true);
        }
        await this.#write(join(this.directory, 'writer-authority.json'), JSON.stringify(next), false, () => {
          observedFloor = this.#time(observedFloor);
          check(next.grant && Date.parse(next.grant.expiresAt) > observedFloor, 'SYNC_WRITER_EXPIRED', 'The reviewed writer grant expired before admission.');
          fullAdmin(state, context); fullAdmin(state, { memberId: target.id, role: target.role, epoch: input.epoch, channel: 'desktop' });
          check(writerStateDigest(state) === digest, 'SYNC_WRITER_STATE_CONFLICT', 'The workspace changed before the reviewed authority commit.');
        });
        observedFloor = this.#time(observedFloor);
        return this.#status(state, next, observedFloor, context);
      } finally { await this.#retainObservedFloor(observedFloor); }
    });
  }
  async run<T>(input: SyncWriterState, work: (assertCurrent: () => void) => Promise<SyncWriterWorkResult<T>>): Promise<T> {
    this.#state(input);
    return this.#locked(async () => {
      let authority = await this.#load();
      check(authority, 'SYNC_WRITER_REVIEW_REQUIRED', 'An owner must review local writer authority before a change.');
      const time = await this.#observe(authority), digest = writerStateDigest(input.state), reason = this.#reason(input.state, authority, digest, time) ?? this.#actorReason(input.state, authority, input.context);
      check(reason === null, reason ?? 'SYNC_WRITER_REVIEW_REQUIRED', 'The current local writer is not admitted for this exact workspace state.');
      let active = true, observedFloor = authority.clockFloorMs;
      const assertCurrent = () => {
        check(active, 'SYNC_WRITER_REVIEW_REQUIRED', 'Writer authority cannot be reused outside its transaction.');
        observedFloor = this.#time(observedFloor);
        const currentReason = this.#reason(input.state, authority!, digest, observedFloor) ?? this.#actorReason(input.state, authority!, input.context);
        check(currentReason === null, currentReason ?? 'SYNC_WRITER_REVIEW_REQUIRED', 'Writer authority expired or changed before the commit.');
        check(writerStateDigest(input.state) === digest, 'SYNC_WRITER_STATE_CONFLICT', 'The input authority state changed during the writer transaction.');
      };
      let output: SyncWriterWorkResult<T> | undefined, failed = false, failure: unknown;
      try {
        assertCurrent();
        output = await work(assertCurrent);
        this.#state({ state: output.committedState, vaultId: input.vaultId });
        check(output.committedState.revision >= input.state.revision, 'SYNC_WRITER_STATE_CONFLICT', 'An admitted write cannot rewind the authority revision.');
        const next = { ...authority, stateDigest: writerStateDigest(output.committedState), clockFloorMs: observedFloor };
        assertCurrent(); next.clockFloorMs = observedFloor;
        await this.#write(join(this.directory, 'writer-authority.json'), JSON.stringify(next), false, assertCurrent);
        authority = next;
      } catch (error) { failed = true; failure = error; }
      active = false;
      // Failed/expired attempts retain the previous digest while recording observed clock
      // advance. This prevents rewinding time to resurrect a rejected expired grant.
      try { await this.#retainObservedFloor(observedFloor); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
      if (failed) {
        // The admission process lock is still held. A failed configuration admission cannot
        // expose its volatile setting to a later writer. Durable callers supply no rollback.
        try { output?.rollback?.(); } catch { /* Keep the original admission/flush failure. */ }
        throw failure;
      }
      return output!.result;
    });
  }
}
