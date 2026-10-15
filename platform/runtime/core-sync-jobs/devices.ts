/**
 * Machines and the pen (TR-07, SH-03) and joining from another computer (FR-14). EXPERIMENTAL: tested with two engines
 * on one machine sharing a local folder; no second real computer, network folder or cloud folder has been tried.
 *
 * The shared folder the owner picks holds two things, side by side:
 * - `store/`: the existing encrypted one-writer snapshot store (`FileSyncTransport`), with signed snapshots only;
 * - `devices/`: a small mailbox for joining (`requests/`, `accepted/`, `refused/`) and each computer's last read
 *   (`seen/`). It never holds workspace data: a request carries a device id, a name and a public key; an acceptance
 *   carries the workspace and vault ids and the approving computer's public key, signed by it.
 *
 * Joining: the new computer writes a request and shows a six-digit code made from it. A computer already in shows the
 * same code; the person compares and approves there. That computer adds the machine to the workspace, publishes an
 * encrypted snapshot and writes the signed acceptance. The new computer then checks the signature and the snapshot,
 * places the encrypted backup in its own backups folder for `workspace.restore` (the person types the passphrase), and
 * enrols. Requests expire after 15 minutes and are used once.
 *
 * Removing a machine stops it from ever holding the pen again, but its key does not change: the vault has no re-key
 * method (`keyChanged: false`). What it already copied stays on it.
 */
import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { audit, check, ChausarError, hash, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState } from '../modules/types.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { FileSyncTransport } from '../sync-file-transport.ts';
import type { SyncService, SyncTransport } from '../sync.ts';
import { safeDirectory } from '../vault.ts';
import { deviceIdentity, deviceName, fingerprint, ID, readEnrolment, readPendingJoin, readRecord, writeEnrolment, writePendingJoin, writeRecord } from './device-files.ts';
import type { Enrolment, SyncFolder } from './device-files.ts';
import { asPenWork, currentPen, devicesOf, initialDevices, MODULE_ID, PenWriterAdmission, signPen } from './pen.ts';
import type { DevicesState, PenRecord } from './pen.ts';

const JOIN_MS = 15 * 60_000;
const ns = (state: State) => moduleState<DevicesState>(state, MODULE_ID, initialDevices);
const fail = (code: string, message: string): never => { throw new ChausarError(code, message); };
function fields(payload: Record<string, unknown>, allowed: string[]) {
  check(Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_DEVICE_REQUEST', 'This device request has fields it does not use.');
}
function inApp(ctx: Context) { check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Manage machines inside the desktop app.'); }
function confirmed(payload: Record<string, unknown>) { check(payload.confirm === true, 'CONFIRMATION_REQUIRED', 'Confirm this in the app.'); }

/** Paths inside the shared folder. The store must start empty; the mailbox sits beside it. */
export const sharedPaths = (directory: string) => ({ store: join(directory, 'store'), devices: join(directory, 'devices'),
  requests: join(directory, 'devices', 'requests'), accepted: join(directory, 'devices', 'accepted'), refused: join(directory, 'devices', 'refused'), seen: join(directory, 'devices', 'seen') });
async function sharedFolder(directory: unknown, create: boolean): Promise<string> {
  check(typeof directory === 'string' && directory.length <= 1024 && isAbsolute(directory), 'INVALID_DEVICE_REQUEST', 'Choose the shared folder by its full path.');
  let real: string; try { real = await safeDirectory(directory); } catch { return fail('DEVICE_FOLDER_UNAVAILABLE', 'The shared folder cannot be reached from this computer.'); }
  const paths = sharedPaths(real);
  if (create) for (const path of [paths.store, paths.requests, paths.accepted, paths.refused, paths.seen]) await mkdir(path, { recursive: true, mode: 0o700 });
  else for (const path of [paths.store, paths.requests, paths.accepted]) { const stat = await lstat(path).catch(() => null); check(stat?.isDirectory() && !stat.isSymbolicLink(), 'DEVICE_FOLDER_NOT_SET_UP', 'Set up sync on a computer that is already in, with this folder.'); }
  return real;
}

const vaultIdOf = (host: ModuleHost) => (host.store as unknown as { vaultId: string }).vaultId;
const syncOf = (host: ModuleHost) => host.services.sync as SyncService | undefined;
/** True when this engine started with this computer's pen admission for the open workspace. */
function configured(host: ModuleHost, enrolment: Enrolment | null): boolean {
  const admission = syncOf(host)?.options.writerAdmission;
  return !!enrolment && admission instanceof PenWriterAdmission && admission.deviceId === enrolment.deviceId
    && admission.workspaceId === host.store.read().workspace.id && admission.vaultId === vaultIdOf(host);
}
async function context(host: ModuleHost) {
  const enrolment = await readEnrolment(host.directory), state = host.store.read();
  const mine = enrolment && enrolment.workspaceId === state.workspace.id && enrolment.vaultId === vaultIdOf(host) ? enrolment : null;
  const device = await deviceIdentity(host.directory);
  return { enrolment: mine, device, state, configured: configured(host, mine) };
}

type Seen = { format: 'chausar.device-seen.v1'; deviceId: string; at: string; revision: number };
async function seenTimes(folder: SyncFolder | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>(); if (folder?.kind !== 'folder') return out;
  const directory = sharedPaths(folder.directory).seen; let names: string[] = [];
  try { names = await readdir(directory); } catch { return out; }
  for (const name of names.filter(n => /^device_[a-z0-9-]{36}\.json$/.test(n))) {
    try { const seen = await readRecord<Seen>(join(directory, name)); if (seen?.format === 'chausar.device-seen.v1' && typeof seen.at === 'string') out.set(seen.deviceId, seen.at); } catch {}
  }
  return out;
}
function penView(state: State, thisDevice: string | null, holds: boolean) {
  const pen = currentPen(state), devices = devicesOf(state).devices, holder = pen ? devices.find(d => d.id === pen.deviceId) : undefined;
  const published = pen ? state.modelReceipts.some(r => r?.kind === 'sync-preview' && r.status === 'completed' && typeof r.createdAt === 'string' && r.createdAt >= pen.at) : false;
  return { holder: holder ? { id: holder.id, name: holder.name } : null, thisComputerHolds: holds, seq: pen?.seq ?? 0, since: pen?.at ?? null, kind: pen?.kind ?? null,
    handOver: pen && pen.kind === 'hand-over' && pen.from === thisDevice ? { to: pen.deviceId, published } : null };
}
async function holds(host: ModuleHost, configuredHere: boolean, state: State) {
  const admission = syncOf(host)?.options.writerAdmission;
  return configuredHere && admission instanceof PenWriterAdmission ? (await admission.holds(state)).holds : false;
}

/** Adds every recorded machine's key to the sync service's signers, so snapshots each of them signed can be read. */
function installTrust(host: ModuleHost, ctx: Context, state: State) {
  const sync = syncOf(host); if (!sync) return;
  for (const device of devicesOf(state).devices) {
    try { sync.trustDevice(ctx, { signerId: device.id, publicKey: device.publicKey, memberId: device.memberId, epoch: device.epoch }); } catch {}
  }
}
async function ensureOn(host: ModuleHost, enrolment: Enrolment) {
  check(enrolment.syncOn, 'SYNC_OFF', 'Sync is off. The owner turns it on first.');
  const status = await host.call('sync.status', {}) as { enabled?: boolean; transport?: string | null };
  check(status.transport, 'SYNC_NOT_CONNECTED', 'Sync has no shared folder yet.');
  if (!status.enabled) await asPenWork('sync', () => host.call('sync.enable', { enabled: true }));
}
/** Publishes the encrypted snapshot of the workspace as it is now: the person already confirmed the step that needs it. */
async function publish(host: ModuleHost) {
  return asPenWork('sync', async () => {
    const preview = await host.call('sync.preview', {}) as { id: string };
    const approval = await host.call('sync.approve', { id: preview.id }) as { id: string };
    const pushed = await host.call('sync.push', { previewId: preview.id, approvalId: approval.id }) as { head: { revision: number } };
    return { revision: pushed.head.revision };
  });
}

// ---- reads ----

async function list(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  fields(payload, []);
  const { enrolment, device, state, configured: here } = await context(host);
  const registry = devicesOf(state), thisId = device?.identity.deviceId ?? null, seen = await seenTimes(enrolment?.transport);
  const holding = await holds(host, here, state), pen = currentPen(state);
  const admin = ['owner', 'cofounder'].includes(ctx.role);
  return {
    thisDevice: device ? { id: device.identity.deviceId, name: device.identity.name, enrolled: !!enrolment && registry.devices.some(d => d.id === thisId && d.removedAt === null) } : null,
    configured: here, syncOn: enrolment?.syncOn ?? false, transport: enrolment ? { kind: enrolment.transport.kind } : null,
    readOnly: here && !holding, pen: penView(state, thisId, holding),
    devices: registry.devices.map(d => ({ id: d.id, name: d.name, thisComputer: d.id === thisId, holdsPen: pen?.deviceId === d.id, state: d.removedAt ? 'removed' : 'active',
      enrolledAt: d.enrolledAt, removedAt: d.removedAt, lastReadAt: seen.get(d.id) ?? null, fingerprint: fingerprint(d.publicKey), ...(admin ? { memberId: d.memberId } : {}) })),
    keyChangeOnRemove: 'not-built', experimental: true,
  };
}
async function pen(_ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  fields(payload, []);
  const { device, state, configured: here } = await context(host), holding = await holds(host, here, state);
  return { ...penView(state, device?.identity.deviceId ?? null, holding), configured: here, readOnly: here && !holding };
}

// ---- set-up ----

async function setup(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); check(['owner', 'cofounder'].includes(ctx.role), 'OWNER_REQUIRED', 'The owner sets up sync.');
  if (Object.hasOwn(payload, 'on')) {
    fields(payload, ['on']); check(typeof payload.on === 'boolean', 'INVALID_DEVICE_REQUEST', 'Say whether sync is on.');
    const { enrolment, configured: here } = await context(host);
    check(enrolment, 'DEVICE_NOT_ENROLLED', 'Set up sync with a shared folder first.');
    check(here, 'SYNC_RESTART_REQUIRED', 'Restart Chausar to finish setting up sync on this computer.');
    await asPenWork('sync', () => host.call('sync.enable', { enabled: payload.on }));
    await writeEnrolment(host.directory, { ...enrolment, syncOn: payload.on as boolean });
    return list(ctx, {}, host);
  }
  fields(payload, ['transport', 'folder', 'deviceName']);
  check(payload.transport === 'folder' || payload.transport === 'drive', 'INVALID_DEVICE_REQUEST', 'Choose a shared folder or Google Drive.');
  check(payload.transport === 'folder' || payload.folder === undefined, 'INVALID_DEVICE_REQUEST', 'Google Drive needs no folder path.');
  const state = host.store.read(), workspaceId = state.workspace.id, vaultId = vaultIdOf(host);
  const existing = await readEnrolment(host.directory);
  check(!existing || existing.workspaceId === workspaceId && existing.vaultId === vaultId, 'DEVICE_ENROLLED_ELSEWHERE', 'This computer already syncs another workspace.');
  const device = await deviceIdentity(host.directory, { name: payload.deviceName === undefined ? undefined : deviceName(payload.deviceName) });
  const me = device!.identity, registry = devicesOf(state);
  check(registry.devices.length === 0 || registry.devices.some(d => d.id === me.deviceId && d.removedAt === null), registry.devices.some(d => d.id === me.deviceId) ? 'DEVICE_REMOVED' : 'DEVICE_NOT_JOINED', 'Join this workspace from a computer that is already in.');
  let transport: SyncFolder = { kind: 'drive' };
  if (payload.transport === 'folder') {
    const directory = await sharedFolder(payload.folder, true), store = sharedPaths(directory).store;
    const identity = await readRecord<{ workspaceId?: string; vaultId?: string }>(join(store, 'store.json')).catch(() => fail('DEVICE_FOLDER_IN_USE', 'This folder holds something else. Choose an empty folder.'));
    if (identity) check(identity.workspaceId === workspaceId && identity.vaultId === vaultId, 'DEVICE_FOLDER_IN_USE', 'This folder already syncs another workspace.');
    else check((await readdir(store)).length === 0, 'DEVICE_FOLDER_IN_USE', 'This folder holds something else. Choose an empty folder.');
    transport = { kind: 'folder', directory };
  }
  if (registry.devices.length === 0) await host.store.update(draft => {
    const own = ns(draft); check(own.devices.length === 0, 'DEVICE_NOT_JOINED', 'Join this workspace from a computer that is already in.');
    const at = now();
    own.devices.push({ id: me.deviceId, name: me.name, publicKey: me.publicKey, memberId: ctx.memberId, epoch: ctx.epoch, enrolledAt: at, removedAt: null, addedBy: null });
    own.pen = signPen(workspaceId, { seq: 1, deviceId: me.deviceId, from: null, at, kind: 'first' }, device!.signingKey);
    audit(draft, 'device.enrolled', { memberId: ctx.memberId });
  });
  const enrolment: Enrolment = { format: 'chausar.device-enrolment.v1', workspaceId, vaultId, deviceId: me.deviceId, transport, syncOn: existing?.syncOn ?? false, enrolledAt: existing?.enrolledAt ?? now() };
  await writeEnrolment(host.directory, enrolment);
  return { ...await list(ctx, {}, host), restartRequired: !configured(host, enrolment) };
}

// ---- the pen ----

async function handOver(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['toDeviceId', 'confirm', 'retry']);
  const { enrolment, device, state, configured: here } = await context(host);
  check(enrolment && here && device, 'SYNC_RESTART_REQUIRED', 'Set up sync on this computer and restart Chausar first.');
  const me = device!.identity.deviceId;
  if (payload.retry === true) {
    const pen = currentPen(state); check(pen?.kind === 'hand-over' && pen.from === me, 'NOTHING_TO_RETRY', 'There is no hand-over from this computer waiting to be sent.');
    await ensureOn(host, enrolment!); installTrust(host, ctx, state);
    const published = await publish(host); return { ...await penNow(host), published: true, revision: published.revision };
  }
  confirmed(payload);
  check(typeof payload.toDeviceId === 'string' && ID.test(payload.toDeviceId), 'INVALID_DEVICE_REQUEST', 'Choose the computer to hand the pen to.');
  check(await holds(host, here, state), 'SYNC_READ_ONLY_DEVICE', 'Only the computer that holds the pen can hand it over.');
  const target = devicesOf(state).devices.find(d => d.id === payload.toDeviceId);
  check(target && target.removedAt === null && target.id !== me, 'DEVICE_NOT_FOUND', 'Choose another computer that is in this workspace.');
  await ensureOn(host, enrolment!); installTrust(host, ctx, state);
  await host.store.update(draft => {
    const own = ns(draft), pen = currentPen(draft); check(pen?.deviceId === me, 'SYNC_READ_ONLY_DEVICE', 'Only the computer that holds the pen can hand it over.');
    own.pen = signPen(draft.workspace.id, { seq: pen.seq + 1, deviceId: target!.id, from: me, at: now(), kind: 'hand-over' }, device!.signingKey);
    audit(draft, 'device.pen.handed-over', { memberId: ctx.memberId });
  });
  // This computer is read only from here. The snapshot that carries the hand-over is sent as sync bookkeeping;
  // if sending fails, `{ retry: true }` sends it again and the pen waits in between.
  try { const published = await publish(host); return { ...await penNow(host), published: true, revision: published.revision }; }
  catch (error) { return { ...await penNow(host), published: false, errorCode: error instanceof ChausarError ? error.code : 'SYNC_FAILED' }; }
}
async function penNow(host: ModuleHost) { return pen({} as Context, {}, host); }

async function takePen(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['confirm']); confirmed(payload);
  const { enrolment, device, state, configured: here } = await context(host);
  check(enrolment && here && device, 'SYNC_RESTART_REQUIRED', 'Set up sync on this computer and restart Chausar first.');
  const me = device!.identity.deviceId, current = currentPen(state);
  check(!(await holds(host, here, state)), 'PEN_ALREADY_HELD', 'This computer already holds the pen.');
  check(devicesOf(state).devices.some(d => d.id === me && d.removedAt === null), 'DEVICE_REMOVED', 'This computer was removed from the workspace.');
  await asPenWork('pen', () => host.store.update(draft => {
    const own = ns(draft), pen = currentPen(draft);
    own.pen = signPen(draft.workspace.id, { seq: (pen?.seq ?? current?.seq ?? 0) + 1, deviceId: me, from: pen?.deviceId ?? null, at: now(), kind: 'take-over' }, device!.signingKey);
    audit(draft, 'device.pen.taken', { memberId: ctx.memberId });
  }));
  return { ...await penNow(host), experimental: true, lateChanges: 'settle-by-hand' };
}

async function remove(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['deviceId', 'confirm']); confirmed(payload);
  const { device, state, configured: here } = await context(host);
  check(typeof payload.deviceId === 'string' && ID.test(payload.deviceId), 'INVALID_DEVICE_REQUEST', 'Choose the computer to remove.');
  const registry = devicesOf(state); check(registry.devices.length > 0, 'DEVICE_NOT_FOUND', 'No computers are recorded for this workspace.');
  check(!here || await holds(host, here, state), 'SYNC_READ_ONLY_DEVICE', 'Remove a computer from the one that holds the pen.');
  check(payload.deviceId !== device?.identity.deviceId, 'DEVICE_IS_THIS_COMPUTER', 'This computer cannot remove itself.');
  check(currentPen(state)?.deviceId !== payload.deviceId, 'DEVICE_HOLDS_PEN', 'Take the pen back from that computer first.');
  await host.store.update(draft => {
    const target = ns(draft).devices.find(d => d.id === payload.deviceId); check(target && target.removedAt === null, 'DEVICE_NOT_FOUND', 'That computer is not in this workspace.');
    target.removedAt = now(); audit(draft, 'device.removed', { memberId: ctx.memberId });
  });
  return { removed: true, deviceId: payload.deviceId, keyChanged: false, keyChange: 'VAULT_REKEY_NOT_BUILT', copiesStay: true };
}

/** Reads the newest encrypted snapshot into a new folder. The person then switches to it (lock, then open that folder). */
async function read(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['passphrase']);
  check(typeof payload.passphrase === 'string' && payload.passphrase.length > 0 && payload.passphrase.length <= 1024, 'INVALID_DEVICE_REQUEST', 'Type the workspace passphrase.');
  const { enrolment, device, state, configured: here } = await context(host);
  check(enrolment && here && device, 'SYNC_RESTART_REQUIRED', 'Set up sync on this computer and restart Chausar first.');
  await ensureOn(host, enrolment!); installTrust(host, ctx, state);
  const transport = syncOf(host)!.options.transport as SyncTransport; const head = await transport.getHead();
  if (!head || head.revision <= state.revision) return { upToDate: true, revision: state.revision };
  const snapshot = await transport.get(head.recordHash);
  const signer = devicesOf(state).devices.find(d => d.id === snapshot?.signerId);
  check(signer && signer.removedAt === null, 'SYNC_UNTRUSTED_DEVICE', 'The newest copy was written by a computer that is not in this workspace.');
  const folder = `synced-${head.revision}-${randomUUID().slice(0, 8)}`;
  await asPenWork('sync', () => host.call('sync.pull', { folder, passphrase: payload.passphrase }));
  if (enrolment!.transport.kind === 'folder') await writeRecord(join(sharedPaths(enrolment!.transport.directory).seen, `${device!.identity.deviceId}.json`),
    { format: 'chausar.device-seen.v1', deviceId: device!.identity.deviceId, at: now(), revision: head.revision }).catch(() => {});
  return { upToDate: false, folder, revision: head.revision, switch: 'lock-then-open-folder' };
}

// ---- joining (FR-14) ----

type JoinRequest = { format: 'chausar.device-join-request.v1'; requestId: string; deviceId: string; name: string; publicKey: string; createdAt: string; expiresAt: string };
type Acceptance = { format: 'chausar.device-join-accepted.v1'; requestId: string; deviceId: string; workspaceId: string; vaultId: string; approverDeviceId: string; approverPublicKey: string; at: string; signature: string };
const requestCode = (request: JoinRequest) => String(parseInt(createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 8), 16) % 1_000_000).padStart(6, '0');
const acceptanceBody = (a: Omit<Acceptance, 'signature'>) => Buffer.from(JSON.stringify({ format: a.format, requestId: a.requestId, deviceId: a.deviceId, workspaceId: a.workspaceId, vaultId: a.vaultId, approverDeviceId: a.approverDeviceId, approverPublicKey: a.approverPublicKey, at: a.at }));
async function readRequest(directory: string, requestId: string): Promise<JoinRequest | null> {
  const value = await readRecord<JoinRequest>(join(sharedPaths(directory).requests, `${requestId}.json`));
  if (!value) return null;
  check(value.format === 'chausar.device-join-request.v1' && value.requestId === requestId && ID.test(value.deviceId) && typeof value.name === 'string' && typeof value.publicKey === 'string' && typeof value.expiresAt === 'string', 'DEVICE_JOIN_INVALID', 'This join request is not valid.');
  try { check(createPublicKey(value.publicKey).asymmetricKeyType === 'ed25519', 'DEVICE_JOIN_INVALID', 'This join request is not valid.'); } catch { fail('DEVICE_JOIN_INVALID', 'This join request is not valid.'); }
  return value;
}

/** On a computer already in: list waiting requests with their codes, approve one after comparing codes, or refuse it. */
async function inviteVerify(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['requestId', 'code', 'approve']);
  const { enrolment, device, state, configured: here } = await context(host);
  check(enrolment?.transport.kind === 'folder', enrolment ? 'DEVICE_JOIN_NEEDS_FOLDER' : 'DEVICE_NOT_ENROLLED', 'Joining works through a shared folder set up on this computer.');
  const directory = (enrolment!.transport as { directory: string }).directory, paths = sharedPaths(directory), registry = devicesOf(state);
  if (payload.requestId === undefined) {
    let names: string[] = []; try { names = await readdir(paths.requests); } catch {}
    const requests = [];
    for (const name of names.filter(n => /^join_[a-f0-9-]{36}\.json$/.test(n))) {
      const requestId = name.slice(0, -5); let request: JoinRequest | null = null; try { request = await readRequest(directory, requestId); } catch { continue; }
      if (!request || Date.parse(request.expiresAt) <= Date.now() || registry.usedRequests.includes(requestId) || await readRecord(join(paths.refused, name)).catch(() => null)) continue;
      requests.push({ requestId, name: request.name, code: requestCode(request), expiresAt: request.expiresAt, fingerprint: fingerprint(request.publicKey) });
    }
    return { requests };
  }
  check(typeof payload.requestId === 'string' && /^join_[a-f0-9-]{36}$/.test(payload.requestId) && typeof payload.approve === 'boolean', 'INVALID_DEVICE_REQUEST', 'Choose a request and say whether to approve it.');
  const requestId = payload.requestId as string, request = await readRequest(directory, requestId);
  check(request, 'DEVICE_JOIN_NOT_FOUND', 'This request was not found.');
  if (!payload.approve) { await writeRecord(join(paths.refused, `${requestId}.json`), { format: 'chausar.device-join-refused.v1', requestId, at: now() }); return { refused: true, requestId }; }
  check(payload.code === requestCode(request!), 'DEVICE_JOIN_CODE_MISMATCH', 'The codes do not match. Do not approve.');
  check(Date.parse(request!.expiresAt) > Date.now(), 'DEVICE_JOIN_EXPIRED', 'This request expired. Start again on the new computer.');
  check(here && await holds(host, here, state), 'SYNC_READ_ONLY_DEVICE', 'Approve a new computer on the one that holds the pen.');
  const already = registry.devices.find(d => d.id === request!.deviceId);
  check(!registry.usedRequests.includes(requestId) || already, 'DEVICE_JOIN_USED', 'This request was already used.');
  check(!already || already.removedAt === null, 'DEVICE_REMOVED', 'That computer was removed from this workspace.');
  await ensureOn(host, enrolment!); installTrust(host, ctx, state);
  if (!already) await host.store.update(draft => {
    const own = ns(draft); check(!own.usedRequests.includes(requestId), 'DEVICE_JOIN_USED', 'This request was already used.');
    own.devices.push({ id: request!.deviceId, name: request!.name, publicKey: request!.publicKey, memberId: ctx.memberId, epoch: ctx.epoch, enrolledAt: now(), removedAt: null, addedBy: device!.identity.deviceId });
    own.usedRequests.push(requestId); audit(draft, 'device.joined', { memberId: ctx.memberId });
  });
  const published = await publish(host);
  const body: Omit<Acceptance, 'signature'> = { format: 'chausar.device-join-accepted.v1', requestId, deviceId: request!.deviceId, workspaceId: state.workspace.id, vaultId: vaultIdOf(host), approverDeviceId: device!.identity.deviceId, approverPublicKey: device!.identity.publicKey, at: now() };
  await writeRecord(join(paths.accepted, `${requestId}.json`), { ...body, signature: sign(null, acceptanceBody(body), device!.signingKey).toString('base64url') } satisfies Acceptance);
  return { approved: true, requestId, deviceId: request!.deviceId, revision: published.revision };
}

/** On the new computer, before any workspace is open: make a join request, then pick up the approved snapshot. */
async function join_(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  inApp(ctx); fields(payload, ['step', 'folder', 'deviceName']);
  check(payload.step === 'request' || payload.step === 'finish' || payload.step === 'cancel', 'INVALID_DEVICE_REQUEST', 'Say which join step this is.');
  check(!await readEnrolment(host.directory), 'DEVICE_ALREADY_ENROLLED', 'This computer already syncs a workspace.');
  if (payload.step === 'cancel') { fields(payload, ['step']); await writePendingJoin(host.directory, null); return { state: 'cancelled' }; }
  if (payload.step === 'request') {
    const directory = await sharedFolder(payload.folder, false);
    const device = await deviceIdentity(host.directory, { name: payload.deviceName === undefined ? undefined : deviceName(payload.deviceName) });
    const at = new Date(), request: JoinRequest = { format: 'chausar.device-join-request.v1', requestId: `join_${randomUUID()}`, deviceId: device!.identity.deviceId, name: device!.identity.name,
      publicKey: device!.identity.publicKey, createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + JOIN_MS).toISOString() };
    await writeRecord(join(sharedPaths(directory).requests, `${request.requestId}.json`), request, 0o644);
    const code = requestCode(request);
    await writePendingJoin(host.directory, { format: 'chausar.device-join.v1', requestId: request.requestId, directory, code, expiresAt: request.expiresAt });
    return { state: 'waiting', requestId: request.requestId, code, expiresAt: request.expiresAt };
  }
  fields(payload, ['step']);
  const pending = await readPendingJoin(host.directory); check(pending, 'DEVICE_JOIN_NOT_STARTED', 'Start joining on this computer first.');
  const paths = sharedPaths(pending!.directory), device = await deviceIdentity(host.directory);
  check(device, 'DEVICE_FILES_CORRUPT', 'This computer lost its device identity. Start again.');
  if (await readRecord(join(paths.refused, `${pending!.requestId}.json`)).catch(() => null)) { await writePendingJoin(host.directory, null); return { state: 'refused' }; }
  const acceptance = await readRecord<Acceptance>(join(paths.accepted, `${pending!.requestId}.json`));
  if (!acceptance) {
    if (Date.parse(pending!.expiresAt) <= Date.now()) { await writePendingJoin(host.directory, null); return { state: 'expired' }; }
    return { state: 'waiting', requestId: pending!.requestId, code: pending!.code, expiresAt: pending!.expiresAt };
  }
  const { signature, ...body } = acceptance;
  let valid = false; try { valid = acceptance.format === 'chausar.device-join-accepted.v1' && acceptance.requestId === pending!.requestId && acceptance.deviceId === device!.identity.deviceId
    && createPublicKey(acceptance.approverPublicKey).asymmetricKeyType === 'ed25519' && verify(null, acceptanceBody(body), createPublicKey(acceptance.approverPublicKey), Buffer.from(signature, 'base64url')); } catch {}
  check(valid, 'DEVICE_JOIN_INVALID', 'The approval in the shared folder is not valid. Do not continue.');
  const transport = new FileSyncTransport({ directory: paths.store, workspaceId: acceptance.workspaceId, vaultId: acceptance.vaultId });
  const head = await transport.getHead(); check(head, 'SYNC_EMPTY', 'The shared folder has no encrypted copy yet.');
  const snapshot = await transport.get(head!.recordHash);
  let signed = false; try { const { signature: s, ...rest } = snapshot!; signed = snapshot!.signerId === acceptance.approverDeviceId && hash(snapshot!.ciphertextBase64) === snapshot!.ciphertextDigest
    && snapshot!.workspaceId === acceptance.workspaceId && snapshot!.vaultId === acceptance.vaultId
    && verify(null, Buffer.from(JSON.stringify(rest)), createPublicKey(acceptance.approverPublicKey), Buffer.from(s, 'base64url')); } catch {}
  check(signed, 'SYNC_UNTRUSTED_DEVICE', 'The newest copy was not written by the computer that approved this one. Try again later.');
  const backups = resolve(host.directory, 'backups'); await mkdir(backups, { recursive: true, mode: 0o700 });
  const backupFile = `joined-${Date.now()}.backup`;
  await writeRecordLarge(join(backups, backupFile), Buffer.from(snapshot!.ciphertextBase64, 'base64'));
  await writeEnrolment(host.directory, { format: 'chausar.device-enrolment.v1', workspaceId: acceptance.workspaceId, vaultId: acceptance.vaultId, deviceId: device!.identity.deviceId,
    transport: { kind: 'folder', directory: pending!.directory }, syncOn: true, enrolledAt: now() });
  await writePendingJoin(host.directory, null);
  return { state: 'ready', backupFile, revision: head!.revision, next: 'restore-then-restart' };
}
async function writeRecordLarge(path: string, bytes: Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); await file.close(); await rename(temporary, path); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}

export const deviceMethods: Record<string, MethodSpec> = {
  'devices.list': { permission: 'read', handler: list },
  'devices.pen': { permission: 'read', handler: pen },
  'devices.handOver': { permission: 'admin', handler: handOver },
  'devices.takePen': { permission: 'admin', handler: takePen },
  'devices.remove': { permission: 'admin', handler: remove },
  'devices.read': { permission: 'admin', handler: read },
  'devices.join': { permission: 'admin', preVault: true, handler: join_ },
  'seats.inviteVerify': { permission: 'admin', handler: inviteVerify },
  'sync.setup': { permission: 'admin', handler: setup },
};
export type { PenRecord };
