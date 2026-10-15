/**
 * The pen (TR-07): one computer at a time may change a synced workspace. The machines and the pen are recorded in the
 * workspace itself, in this lane's module namespace, so every encrypted snapshot carries them:
 *
 * - each machine: its id, name, Ed25519 public key, the member who added it, and when it was removed;
 * - the pen: a sequence number, the holder, the previous holder, and a signature. The first pen and a take-over are
 *   signed by the new holder; a hand-over is signed by the computer that gave the pen away.
 *
 * `PenWriterAdmission` is the Engine's writer admission for an enrolled computer: it lets a write through only when
 * the workspace names this computer as the pen holder and its sequence is not older than the highest one this
 * computer has seen (`pen-floor.json`). Every other computer is read only. Only this module's own sync steps (pulling
 * and publishing the encrypted copy, taking the pen) may record sync bookkeeping on a read-only computer, by running
 * inside `asPenWork`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { check, ChausarError } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { peekModuleState } from '../modules/types.ts';
import type { SyncWriterAdmission, SyncWriterReview, SyncWriterState, SyncWriterStatus, SyncWriterWorkResult } from '../sync-writer-admission.ts';
import { writerStateDigest } from '../sync-writer-admission.ts';
import { deviceDirectory, readRecord, writeRecord } from './device-files.ts';
import type { PenFloor } from './device-files.ts';

export const MODULE_ID = 'core-sync-jobs';
export type DeviceRecord = { id: string; name: string; publicKey: string; memberId: string; epoch: number; enrolledAt: string; removedAt: string | null; addedBy: string | null };
export type PenRecord = { seq: number; deviceId: string; from: string | null; at: string; kind: 'first' | 'hand-over' | 'take-over'; signature: string };
export type DevicesState = { devices: DeviceRecord[]; pen: PenRecord | null; usedRequests: string[] };
export const initialDevices = (): DevicesState => ({ devices: [], pen: null, usedRequests: [] });
export const devicesOf = (state: State): DevicesState => peekModuleState<DevicesState>(state, MODULE_ID) ?? initialDevices();

const penBody = (workspaceId: string, pen: Omit<PenRecord, 'signature'>) =>
  Buffer.from(JSON.stringify({ format: 'chausar.pen.v1', workspaceId, seq: pen.seq, deviceId: pen.deviceId, from: pen.from, at: pen.at, kind: pen.kind }));
export function signPen(workspaceId: string, pen: Omit<PenRecord, 'signature'>, key: KeyObject): PenRecord {
  return { ...pen, signature: sign(null, penBody(workspaceId, pen), key).toString('base64url') };
}
/** The pen as recorded, or null when it is missing, unsigned or names a removed machine. */
export function currentPen(state: State): PenRecord | null {
  const { devices, pen } = devicesOf(state);
  if (!pen || !Number.isSafeInteger(pen.seq) || pen.seq < 1) return null;
  const holder = devices.find(d => d.id === pen.deviceId), signer = devices.find(d => d.id === (pen.kind === 'hand-over' ? pen.from : pen.deviceId));
  if (!holder || holder.removedAt !== null || !signer) return null;
  const { signature, ...body } = pen;
  try { return verify(null, penBody(state.workspace.id, body), createPublicKey(signer.publicKey), Buffer.from(signature, 'base64url')) ? pen : null; } catch { return null; }
}

const work = new AsyncLocalStorage<'sync' | 'pen'>();
/** Runs this module's own sync steps so a read-only computer may record sync bookkeeping or take the pen. */
export function asPenWork<T>(kind: 'sync' | 'pen', run: () => Promise<T>): Promise<T> { return work.run(kind, run); }

export type PenAdmissionOptions = { directory: string; workspaceId: string; vaultId: string; deviceId: string };
export class PenWriterAdmission implements SyncWriterAdmission {
  readonly deviceId: string; readonly workspaceId: string; readonly vaultId: string; readonly directory: string;
  #floor: Promise<unknown> = Promise.resolve();
  constructor(options: PenAdmissionOptions) {
    check([options.workspaceId, options.vaultId, options.deviceId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200), 'SYNC_WORKSPACE_MISMATCH', 'Bind the pen to exact workspace, vault and device identities.');
    this.directory = options.directory; this.workspaceId = options.workspaceId; this.vaultId = options.vaultId; this.deviceId = options.deviceId;
  }
  #path() { return join(deviceDirectory(this.directory), 'pen-floor.json'); }
  async #seen(): Promise<number> {
    const floor = await readRecord<PenFloor>(this.#path());
    if (!floor || floor.workspaceId !== this.workspaceId || floor.vaultId !== this.vaultId || floor.deviceId !== this.deviceId) return 0;
    check(floor.format === 'chausar.pen-floor.v1' && Number.isSafeInteger(floor.seq) && floor.seq >= 0, 'DEVICE_FILES_CORRUPT', 'The pen record on this computer is not valid.');
    return floor.seq;
  }
  /** The floor only rises, and only from the state this computer actually committed or opened. */
  #raise(state: State) {
    const pen = currentPen(state); if (!pen) return this.#floor;
    return this.#floor = this.#floor.catch(() => {}).then(async () => {
      if (pen.seq > await this.#seen()) await writeRecord(this.#path(), { format: 'chausar.pen-floor.v1', workspaceId: this.workspaceId, vaultId: this.vaultId, deviceId: this.deviceId, seq: pen.seq } satisfies PenFloor);
    });
  }
  #mine(input: SyncWriterState) { return input.state?.workspace?.id === this.workspaceId && input.vaultId === this.vaultId; }
  async holds(state: State): Promise<{ holds: boolean; reason: string | null; seq: number }> {
    const pen = currentPen(state);
    if (!pen) return { holds: false, reason: 'SYNC_PEN_MISSING', seq: 0 };
    if (pen.deviceId !== this.deviceId) return { holds: false, reason: 'SYNC_READ_ONLY_DEVICE', seq: pen.seq };
    if (pen.seq < await this.#seen()) return { holds: false, reason: 'SYNC_PEN_STALE_COPY', seq: pen.seq };
    return { holds: true, reason: null, seq: pen.seq };
  }
  async status(input: SyncWriterState): Promise<SyncWriterStatus> {
    const digest = writerStateDigest(input.state);
    if (!this.#mine(input)) return { readonly: false, reason: null, fence: 0, stateDigest: digest, localStateDigest: digest, grant: null, qualification: 'local-cooperative-process-only' };
    const pen = await this.holds(input.state); if (pen.holds) await this.#raise(input.state);
    return { readonly: !pen.holds, reason: pen.reason, fence: pen.seq, stateDigest: digest, localStateDigest: digest, grant: null, qualification: 'local-cooperative-process-only' };
  }
  async review(_context: Context, _state: State, _vaultId: string, _input: SyncWriterReview): Promise<SyncWriterStatus> {
    throw new ChausarError('SYNC_PEN_MANAGED', 'This computer writes only while it holds the pen. Hand over the pen instead.');
  }
  async run<T>(input: SyncWriterState, run: (assertCurrent: () => void) => Promise<SyncWriterWorkResult<T>>): Promise<T> {
    if (!this.#mine(input)) return (await run(() => {})).result;
    const pen = await this.holds(input.state), allowed = pen.holds || work.getStore() !== undefined;
    check(allowed, pen.reason ?? 'SYNC_READ_ONLY_DEVICE', 'This computer is read only. Changes are made on the computer that holds the pen.');
    const output = await run(() => check(allowed, pen.reason ?? 'SYNC_READ_ONLY_DEVICE', 'This computer is read only.'));
    // A failed floor write is retried on the next status or write; it never undoes a committed change.
    await this.#raise(output.committedState).catch(() => {});
    return output.result;
  }
}
