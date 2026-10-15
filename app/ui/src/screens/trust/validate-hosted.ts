/**
 * Reply checks for the "This computer" groups of TR-12, the hosted backup and always-on job screens (TR-12, TR-14),
 * Machines and sync (TR-07) and Trust · Keys. Shapes are read from the engine code that answers each method:
 * jobs-ext `jobsx.background` / `jobsx.setBackground` (platform/runtime/jobs-ext/methods.ts), hosted-link
 * `hosted.*` (platform/runtime/hosted-link/service.ts, drive-sync.ts) and connectors-ext `connectorsx.*`
 * (platform/runtime/connectors-ext/service.ts), release's `shell.startAtLogin` / `shell.setStartAtLogin`, and
 * core-sync-jobs' `devices.*` and `sync.setup` (their round-4 contracts). Every reply is untrusted data.
 */
import { ShapeError, bool, int, list, oneOf, rec, str, strings } from './kit/validate.ts';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
function instant(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!INSTANT.test(s)) throw new ShapeError(path);
  return s;
}
function optInstant(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : instant(value, path);
}
function id(value: unknown, path: string, max = 200): string {
  const s = str(value, path, max);
  if (s.length === 0) throw new ShapeError(path);
  return s;
}
function count(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0) throw new ShapeError(path);
  return n;
}

// ---------- TR-12 This computer ----------
/** `shell.startAtLogin {}` and `shell.setStartAtLogin { enabled, confirmed: true }` (release, round 4) reply
 *  `{ platform, mechanism, enabled, path, matches }`. `matches` is false when the entry starts another copy of Chausar. */
export interface StartAtLogin { enabled: boolean; mechanism: 'windows-run-key' | 'macos-launch-agent' | 'linux-xdg-autostart'; matches: boolean | null }
const LOGIN_MECHANISMS = ['windows-run-key', 'macos-launch-agent', 'linux-xdg-autostart'] as const;
export function validateStartAtLogin(reply: unknown): StartAtLogin {
  const r = rec(reply);
  if (typeof r['platform'] !== 'string' || !(LOGIN_MECHANISMS as readonly unknown[]).includes(r['mechanism'])) throw new ShapeError('reply.mechanism');
  if (r['path'] !== null && typeof r['path'] !== 'string') throw new ShapeError('reply.path');
  return { enabled: bool(r['enabled'], 'reply.enabled'), mechanism: r['mechanism'] as StartAtLogin['mechanism'],
    matches: r['matches'] === null ? null : bool(r['matches'], 'reply.matches') };
}
/** `jobsx.background`: the switch, whether it was ever asked, and the wake timer's state. `wake.on` is read when jobs-ext adds it. */
export interface Background { backgroundMode: boolean; asked: boolean; wake: { available: boolean; on: boolean; experimental: boolean } }
export function validateBackground(reply: unknown): Background {
  const r = rec(reply), w = rec(r['wake'], 'reply.wake');
  strings(r['rules'], 'reply.rules', 20);
  return {
    backgroundMode: bool(r['backgroundMode'], 'reply.backgroundMode'), asked: bool(r['asked'], 'reply.asked'),
    wake: { available: bool(w['available'], 'reply.wake.available'), on: w['on'] === undefined ? false : bool(w['on'], 'reply.wake.on'), experimental: bool(w['experimental'], 'reply.wake.experimental') },
  };
}
/** `jobsx.setBackground { enabled }` → `{ backgroundMode, asked }`. */
export function validateSetBackground(reply: unknown): { backgroundMode: boolean } {
  const r = rec(reply); bool(r['asked'], 'reply.asked');
  return { backgroundMode: bool(r['backgroundMode'], 'reply.backgroundMode') };
}
/** `jobsx.setWake { enabled }` → `{ enabled }` (assumed; jobs-ext refuses WAKE_TIMER_UNAVAILABLE until the timer exists). */
export function validateSetWake(reply: unknown): { enabled: boolean } {
  return { enabled: bool(rec(reply)['enabled'], 'reply.enabled') };
}

// ---------- TR-12 hosted backup, TR-14 always-on jobs (hosted-link) ----------
export interface HostedStatus {
  configured: boolean; paired: boolean; demo: boolean;
  account: { plan: 'free' | 'paid'; backup: boolean; worker: boolean; refreshedAt: string } | null;
}
export function validateHostedStatus(reply: unknown): HostedStatus {
  const r = rec(reply);
  const a = r['account'] === null || r['account'] === undefined ? null : rec(r['account'], 'reply.account');
  const e = a === null ? null : rec(a['entitlements'], 'reply.account.entitlements');
  return {
    configured: bool(r['configured'], 'reply.configured'), paired: bool(r['paired'], 'reply.paired'), demo: bool(r['demo'], 'reply.demo'),
    account: a === null || e === null ? null : {
      plan: oneOf(a['plan'], 'reply.account.plan', ['free', 'paid'] as const), refreshedAt: instant(a['refreshedAt'], 'reply.account.refreshedAt'),
      backup: bool(e['backup'], 'reply.account.entitlements.backup'), worker: bool(e['worker'], 'reply.account.entitlements.worker'),
    },
  };
}
const BACKUP_ID = /^bk_[0-9a-f]{32}$/;
function backupId(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!BACKUP_ID.test(s)) throw new ShapeError(path);
  return s;
}
export interface HostedBackup { backupId: string; sizeBytes: number; createdAt: string; madeHere: boolean }
export interface HostedBackups { backups: HostedBackup[]; quotaBytes: number; usedBytes: number; keep: number; keyHeldHere: boolean }
export function validateHostedBackups(reply: unknown): HostedBackups {
  const r = rec(reply);
  return {
    backups: list(r['backups'], 'reply.backups', (v, p) => { const b = rec(v, p); str(b['sha256'], `${p}.sha256`, 64);
      return { backupId: backupId(b['backupId'], `${p}.backupId`), sizeBytes: count(b['sizeBytes'], `${p}.sizeBytes`), createdAt: instant(b['createdAt'], `${p}.createdAt`), madeHere: bool(b['madeHere'], `${p}.madeHere`) }; }, 1000),
    quotaBytes: count(r['quotaBytes'], 'reply.quotaBytes'), usedBytes: count(r['usedBytes'], 'reply.usedBytes'), keep: count(r['keep'], 'reply.keep'),
    keyHeldHere: bool(r['keyHeldHere'], 'reply.keyHeldHere'),
  };
}
export function validateHostedUpload(reply: unknown): { backupId: string } {
  const r = rec(reply); count(r['sizeBytes'], 'reply.sizeBytes'); instant(r['createdAt'], 'reply.createdAt');
  return { backupId: backupId(r['backupId'], 'reply.backupId') };
}
const BACKUP_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** `hosted.backup.restore` writes the inner vault backup to this computer for the core `workspace.restore`. */
export function validateHostedRestore(reply: unknown): { backupFile: string } {
  const r = rec(reply);
  if (r['restoreWith'] !== 'workspace.restore') throw new ShapeError('reply.restoreWith');
  const file = str(r['backupFile'], 'reply.backupFile', 200);
  if (!BACKUP_FILE.test(file) || file.includes('..')) throw new ShapeError('reply.backupFile');
  return { backupFile: file };
}
/** The backup key, once, marked secret. Base64 of 32 bytes. */
export function validateExportedKey(reply: unknown): { backupKey: string } {
  const r = rec(reply);
  if (r['secret'] !== true) throw new ShapeError('reply.secret');
  const key = str(r['backupKey'], 'reply.backupKey', 44);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new ShapeError('reply.backupKey');
  return { backupKey: key };
}
export interface WorkerJob { type: string; title: string; enabled: boolean; consentAt: string | null; uses: string }
function workerJob(value: unknown, path: string): WorkerJob {
  const j = rec(value, path);
  const type = str(j['type'], `${path}.type`, 61);
  if (!/^[a-z][a-z-]{1,60}$/.test(type)) throw new ShapeError(`${path}.type`);
  return { type, title: str(j['title'], `${path}.title`, 200), enabled: bool(j['enabled'], `${path}.enabled`), consentAt: optInstant(j['consentAt'], `${path}.consentAt`), uses: str(j['uses'], `${path}.uses`, 300) };
}
/** `hosted.worker.status`: never end-to-end encrypted; the server's label is shown as its own text. */
export interface WorkerStatus { label: string; jobs: WorkerJob[] }
export function validateWorkerStatus(reply: unknown): WorkerStatus {
  const r = rec(reply);
  if (r['endToEndEncrypted'] !== false) throw new ShapeError('reply.endToEndEncrypted');
  return { label: str(r['label'], 'reply.label', 500), jobs: list(r['jobs'], 'reply.jobs', workerJob, 50) };
}
export function validateWorkerSet(reply: unknown): WorkerJob { return workerJob(reply, 'reply'); }
export function validateWorkerDeleted(reply: unknown): { deleted: true } {
  if (rec(reply)['deleted'] !== true) throw new ShapeError('reply.deleted');
  return { deleted: true };
}

// ---------- TR-07 Drive sync (hosted-link) ----------
export const ATTACHMENTS = ['attached', 'not-connected', 'host-transport', 'sign-in-required', 'unavailable'] as const;
export type Attachment = (typeof ATTACHMENTS)[number];
export interface DriveStatus {
  connected: boolean; folderId: string | null; connectedAt: string | null; created: boolean | null; attachment: Attachment;
  signIn: 'available' | 'required' | 'unavailable'; syncEnabled: boolean | null; demo: boolean;
}
export function validateDriveStatus(reply: unknown): DriveStatus {
  const r = rec(reply);
  const sync = r['sync'] === null || r['sync'] === undefined ? null : rec(r['sync'], 'reply.sync');
  const connected = bool(r['connected'], 'reply.connected');
  const folderId = r['folderId'] === null ? null : id(r['folderId'], 'reply.folderId', 200);
  if (connected !== (folderId !== null)) throw new ShapeError('reply.folderId');
  return {
    connected, folderId, connectedAt: optInstant(r['connectedAt'], 'reply.connectedAt'), created: r['created'] === null ? null : bool(r['created'], 'reply.created'),
    attachment: oneOf(r['attachment'], 'reply.attachment', ATTACHMENTS), signIn: oneOf(r['signIn'], 'reply.signIn', ['available', 'required', 'unavailable'] as const),
    syncEnabled: sync === null ? null : bool(sync['enabled'], 'reply.sync.enabled'), demo: bool(r['demo'], 'reply.demo'),
  };
}
export function validateDriveConnected(reply: unknown): { attachment: Attachment } {
  const r = rec(reply);
  if (r['connected'] !== true) throw new ShapeError('reply.connected');
  id(r['folderId'], 'reply.folderId');
  return { attachment: oneOf(r['attachment'], 'reply.attachment', ATTACHMENTS) };
}
export function validateDriveDisconnected(reply: unknown): { disconnected: boolean } {
  const r = rec(reply);
  if (r['filesKept'] !== true) throw new ShapeError('reply.filesKept');
  return { disconnected: bool(r['disconnected'], 'reply.disconnected') };
}

// ---------- TR-07 machines and the pen (core-sync-jobs, round 4) ----------
export interface Device { id: string; name: string; holdsPen: boolean; thisComputer: boolean; removed: boolean; removedAt: string | null; lastReadAt: string | null }
export interface Pen { holderId: string | null; thisComputerHolds: boolean; handOverTo: string | null }
/** `devices.list {}`: whether sync is set up and on, whether this computer is read only, the pen, and every machine. */
export interface DevicesView { configured: boolean; syncOn: boolean; readOnly: boolean; pen: Pen; devices: Device[] }
function penOf(value: unknown, path: string): Pen {
  const r = rec(value, path);
  const holder = r['holder'] === null ? null : rec(r['holder'], `${path}.holder`);
  const hand = r['handOver'] === null || r['handOver'] === undefined ? null : rec(r['handOver'], `${path}.handOver`);
  return { holderId: holder === null ? null : id(holder['id'], `${path}.holder.id`), thisComputerHolds: bool(r['thisComputerHolds'], `${path}.thisComputerHolds`),
    handOverTo: hand === null ? null : id(hand['to'], `${path}.handOver.to`) };
}
export function validateDevices(reply: unknown): DevicesView {
  const r = rec(reply);
  const devices = list(r['devices'], 'reply.devices', (v, p) => { const d = rec(v, p);
    return { id: id(d['id'], `${p}.id`), name: str(d['name'], `${p}.name`, 120), holdsPen: bool(d['holdsPen'], `${p}.holdsPen`), thisComputer: bool(d['thisComputer'], `${p}.thisComputer`),
      removed: oneOf(d['state'], `${p}.state`, ['active', 'removed'] as const) === 'removed', removedAt: optInstant(d['removedAt'], `${p}.removedAt`), lastReadAt: optInstant(d['lastReadAt'], `${p}.lastReadAt`) }; }, 100);
  if (devices.filter((d) => d.holdsPen).length > 1 || devices.filter((d) => d.thisComputer).length > 1) throw new ShapeError('reply.devices');
  return { configured: bool(r['configured'], 'reply.configured'), syncOn: bool(r['syncOn'], 'reply.syncOn'), readOnly: bool(r['readOnly'], 'reply.readOnly'), pen: penOf(r['pen'], 'reply.pen'), devices };
}
/** `devices.handOver { toDeviceId, confirm: true }` → the pen, and whether the hand-over was published to the folder. */
export function validateHandOver(reply: unknown): { published: boolean } {
  const r = rec(reply); penOf(r, 'reply');
  return { published: bool(r['published'], 'reply.published') };
}
/** `devices.remove { deviceId, confirm: true }` → `{ removed: true, keyChanged, copiesStay }`; the key is not changed yet. */
export function validateRemoved(reply: unknown): { keyChanged: boolean } {
  const r = rec(reply);
  if (r['removed'] !== true || r['copiesStay'] !== true) throw new ShapeError('reply.removed');
  return { keyChanged: bool(r['keyChanged'], 'reply.keyChanged') };
}
/** `sync.setup` → the `devices.list` reply, plus `restartRequired` when a transport was set up. */
export function validateSyncSetup(reply: unknown): { syncOn: boolean; restartRequired: boolean } {
  const view = validateDevices(reply), r = rec(reply);
  return { syncOn: view.syncOn, restartRequired: r['restartRequired'] === undefined ? false : bool(r['restartRequired'], 'reply.restartRequired') };
}

// ---------- Trust · Keys (connectors-ext) ----------
export interface Connection { id: string; group: string; road: string; label: string; paused: boolean }
/** `connectorsx.connections {}`: the connections this seat can see; never a credential. */
export function validateConnections(reply: unknown): Connection[] {
  return list(reply, 'reply', (v, p) => { const c = rec(v, p);
    return { id: id(c['id'], `${p}.id`), group: id(c['group'], `${p}.group`, 80), road: oneOf(c['road'], `${p}.road`, ['interface', 'file', 'screen', 'database'] as const),
      label: str(c['label'], `${p}.label`, 200), paused: oneOf(c['status'], `${p}.status`, ['active', 'paused'] as const) === 'paused' }; }, 500);
}
/** `connectorsx.credentials.status { connectionId }`: only whether a credential is there, its kind and when. */
export interface CredentialStatus { available: boolean; present: boolean; kind: 'key' | 'oauth' | null; storedAt: string | null }
export function validateCredentialStatus(reply: unknown): CredentialStatus {
  const r = rec(reply);
  const present = bool(r['present'], 'reply.present');
  const kind = r['kind'] === null ? null : oneOf(r['kind'], 'reply.kind', ['key', 'oauth'] as const);
  if (present !== (kind !== null)) throw new ShapeError('reply.kind');
  if (Object.keys(r).some((k) => !['available', 'present', 'kind', 'storedAt'].includes(k))) throw new ShapeError('reply');
  return { available: bool(r['available'], 'reply.available'), present, kind, storedAt: optInstant(r['storedAt'], 'reply.storedAt') };
}
export function validateCredentialSet(reply: unknown): { stored: true } {
  const r = rec(reply);
  if (r['stored'] !== true) throw new ShapeError('reply.stored');
  if (Object.keys(r).some((k) => !['stored', 'connectionId'].includes(k))) throw new ShapeError('reply');
  return { stored: true };
}
export function validateCredentialRemoved(reply: unknown): { removed: boolean } {
  return { removed: bool(rec(reply)['removed'], 'reply.removed') };
}
