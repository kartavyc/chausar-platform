/** TR-12 the vault (backups, restore test, lock, recovery contact) and TR-13 deletion with its checked report. */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { check, ChausarError, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { Vault } from '../vault.ts';
import { laneState } from './lane-state.ts';
import { fields, references, sha256, tools } from './tools-common.ts';

const LIMIT = 'A program running as you on this computer can read what you can read. The passphrase limits this; it does not remove it.';
const BACKUP_FILE = /^[A-Za-z0-9._-]{1,200}\.backup$/;
type Backup = { file: string; at: string; bytes: number; testRestore: 'passed' | 'failed' | 'not-tested'; testedAt: string | null };

async function files(directory: string, match: (name: string) => boolean) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') return []; throw error; }
  const result: { name: string; at: string; bytes: number; mtimeMs: number }[] = [];
  for (const entry of entries) if (entry.isFile() && match(entry.name)) {
    const info = await stat(join(directory, entry.name)); result.push({ name: entry.name, at: info.mtime.toISOString(), bytes: info.size, mtimeMs: info.mtimeMs });
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
/** Every file under a folder, walked without following links, a few levels deep. */
async function allFiles(directory: string, skip: (path: string) => boolean, depth = 4): Promise<{ path: string; mtimeMs: number }[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') return []; throw error; }
  const found: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name); if (skip(path)) continue;
    if (entry.isFile()) found.push({ path, mtimeMs: (await stat(path)).mtimeMs });
    else if (entry.isDirectory() && depth > 0) found.push(...await allFiles(path, skip, depth - 1));
  }
  return found;
}
const backupsDir = (host: ModuleHost) => join(host.directory, 'backups');
function backupRow(state: State, file: { name: string; at: string; bytes: number }): Backup {
  const tested = tools(state).backups?.[file.name];
  return { file: file.name, at: file.at, bytes: file.bytes, testRestore: tested?.testRestore ?? 'not-tested', testedAt: tested?.testedAt ?? null };
}

export async function vaultView(_ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const t = tools(state);
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try { const info = await statfs(host.directory); disk = { freeBytes: Number(info.bavail) * Number(info.bsize), totalBytes: Number(info.blocks) * Number(info.bsize) }; } catch { disk = null; }
  let version: string | null = null;
  try { const status = await host.call('updates.status', {}) as { version?: unknown }; version = typeof status?.version === 'string' ? status.version : null; } catch { version = null; }
  // The idle lock is the frame's own setting (todayx.shell), which the app enforces; this lane keeps no second copy.
  let idleMinutes: number | null = null;
  try { const shell = await host.call('todayx.shell', {}) as { autoLockMinutes?: unknown }; idleMinutes = Number.isInteger(shell?.autoLockMinutes) ? shell.autoLockMinutes as number : null; } catch { idleMinutes = null; }
  return {
    backups: (await files(backupsDir(host), name => name.endsWith('.backup'))).map(file => backupRow(state, file)),
    lock: { idleMinutes, deviceCheck: t.lock?.deviceCheck ?? false }, disk, limit: LIMIT,
    recoveryContact: { name: t.recoveryContact ?? null, experimental: true as const }, version,
  };
}

function openVaultId(host: ModuleHost): string | null { const id = (host.store as unknown as { vaultId?: unknown }).vaultId; return typeof id === 'string' ? id : null; }

export async function backupNow(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  const made = await host.call('workspace.backup', {}) as { path: string };
  const name = basename(made.path); let parsed: any;
  try { parsed = JSON.parse(await readFile(join(backupsDir(host), name), 'utf8')); } catch { parsed = null; }
  check(parsed?.backupFormat === 'chausar.backup.v1' && parsed.envelope && typeof parsed.envelope.id === 'string' && parsed.envelope.id === openVaultId(host) && parsed.envelope.snapshot,
    'BACKUP_CHECK_FAILED', 'The new backup does not have the structure of a locked copy of this workspace.');
  await host.store.update(state => { (tools(state).backups ??= {})[name] = { testRestore: 'not-tested', testedAt: null, structure: 'checked', checkedAt: now() }; });
  const file = (await files(backupsDir(host), item => item === name))[0];
  check(file, 'BACKUP_CHECK_FAILED', 'The new backup could not be found.');
  return backupRow(host.store.read(), file);
}

/** Opens a copy of the backup in a temporary folder with the vault's own restore path, then deletes the copy. */
export async function testRestore(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { file, passphrase } = fields(payload, ['file', 'passphrase']);
  check(typeof file === 'string' && BACKUP_FILE.test(file) && !file.startsWith('.'), 'INVALID_PATH', 'Choose a backup from this app.');
  check(typeof passphrase === 'string' && passphrase.length > 0 && passphrase.length <= 1024, 'INVALID_PASSPHRASE', 'Type the passphrase for this backup.');
  const found = (await files(backupsDir(host), name => name === file))[0];
  check(found, 'NOT_FOUND', 'That backup is not on this computer.');
  let envelopeId: unknown;
  try { envelopeId = JSON.parse(await readFile(join(backupsDir(host), file), 'utf8'))?.envelope?.id; } catch { envelopeId = undefined; }
  const temporary = await mkdtemp(join(host.directory, 'restore-test-'));
  let result: 'passed' | 'failed' = 'failed';
  try {
    const restored = await Vault.restore({ directory: join(temporary, 'vault'), backupFile: join(backupsDir(host), file), passphrase, storage: 'experimental-file', prepareRestoredState: () => {} });
    try { const identity = restored.readIdentity(); result = identity.vaultId === envelopeId && typeof restored.read().workspace.id === 'string' ? 'passed' : 'failed'; }
    finally { await restored.close(); }
  } catch (error) { if (!(error instanceof ChausarError)) throw error; result = 'failed'; }
  finally { await rm(temporary, { recursive: true, force: true }); }
  const testedAt = now();
  await host.store.update(state => { const backups = (tools(state).backups ??= {}); backups[file] = { ...backups[file], testRestore: result, testedAt }; });
  return backupRow(host.store.read(), found);
}

export async function setLock(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { idleMinutes, deviceCheck } = fields(payload, ['idleMinutes', 'deviceCheck']);
  check(idleMinutes === undefined || (Number.isInteger(idleMinutes) && idleMinutes >= 1 && idleMinutes <= 240), 'INVALID_LOCK', 'Lock after 1 to 240 idle minutes.');
  check(deviceCheck === undefined || typeof deviceCheck === 'boolean', 'INVALID_LOCK', 'Turn the device check on or off.');
  if (idleMinutes !== undefined) await host.call('todayx.lock.settings', { minutes: idleMinutes });
  if (deviceCheck !== undefined) await host.store.update(state => { const t = tools(state); t.lock = { deviceCheck }; });
  return vaultView(ctx, host);
}
export async function setRecoveryContact(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { name } = fields(payload, ['name']);
  check(name === null || (typeof name === 'string' && name.trim().length > 0 && name.length <= 100), 'INVALID_CONTACT', 'Give a name of up to 100 characters, or none.');
  await host.store.update(state => { tools(state).recoveryContact = name === null ? null : name.trim(); });
  return vaultView(ctx, host);
}

type Row = { place: string; state: 'deleted' | 'pending' | 'not-possible' | 'not-built'; reason: string };
const PLACES: [string, keyof State][] = [['Facts', 'facts'], ['Imports', 'imports'], ['Receipts', 'receipts'], ['Answers', 'answers'], ['Decisions', 'decisions'], ['Actions', 'actions'], ['AI model receipts', 'modelReceipts']];
const SENT = new Set(['dispatching', 'completed', 'failed']);

/** Deletes through the trust service, then checks each place before reporting it. */
export async function deleteSource(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { sourceId, confirmation } = fields(payload, ['sourceId', 'confirmation']);
  check(ctx.role === 'owner', 'OWNER_REQUIRED', 'Only the owner can delete a source.');
  check(typeof sourceId === 'string' && sourceId.length > 0 && sourceId.length <= 200, 'INVALID_SOURCE', 'Choose an existing source.');
  check(confirmation === sourceId, 'CONFIRMATION_REQUIRED', 'Type the source name to confirm the deletion.');
  const before = host.store.read(); const factIds = new Set(before.facts.filter(fact => fact.sourceId === sourceId).map(fact => fact.id));
  const sent = before.modelReceipts.filter(r => SENT.has(r.status) && references(r, sourceId, factIds)).length;
  const startedAt = Date.now(); const at = now();
  // The engine's own deletion, with its managed-copy cleanup (older managed backups and exports), callable from this request.
  await host.services.sourceDeletion.delete(sourceId);
  const after = host.store.read(); const rows: Row[] = [];
  for (const [place, key] of PLACES) {
    const left = (after[key] as unknown[]).filter(item => references(item, sourceId, factIds)).length;
    rows.push(left ? { place, state: 'pending', reason: `${left} still refer to it.` } : { place, state: 'deleted', reason: 'Checked: nothing here refers to it.' });
  }
  const lane = structuredClone(laneState(after)); delete lane.tools.deletions;
  rows.push(references(lane, sourceId, factIds) ? { place: 'Reports, Tools and Trust records', state: 'pending', reason: 'Something here still refers to it.' }
    : { place: 'Reports, Tools and Trust records', state: 'deleted', reason: 'Checked: nothing here refers to it.' });
  const older = (await files(backupsDir(host), name => name.endsWith('.backup'))).filter(file => file.mtimeMs <= startedAt);
  rows.push(older.length ? { place: 'Backups on this computer', state: 'pending', reason: 'Older backups still hold it until they are replaced.' }
    : { place: 'Backups on this computer', state: 'deleted', reason: 'Checked: no backup made before the deletion is on this computer.' });
  // Page exports, question files and "Export everything" folders sit in sub-folders; a file the purge could not remove is still found here.
  const exportsRoot = join(host.directory, 'exports'), deletionReports = join(exportsRoot, 'deletions');
  const exports = (await allFiles(exportsRoot, path => path === deletionReports)).filter(file => file.mtimeMs <= startedAt);
  rows.push(exports.length ? { place: 'Exports on this computer', state: 'pending', reason: 'Exported files made before the deletion may hold it. Delete them yourself.' }
    : { place: 'Exports on this computer', state: 'deleted', reason: 'Checked: no export made before the deletion is on this computer.' });
  rows.push(sent ? { place: 'AI provider', state: 'not-possible', reason: 'The provider keeps requests for its stated period.' }
    : { place: 'AI provider', state: 'deleted', reason: 'Checked: no request that used it left this computer.' });
  rows.push({ place: 'Briefs already sent', state: 'not-possible', reason: 'A brief that was already sent cannot be called back.' });
  rows.push({ place: 'Old versions in Google Drive', state: 'not-built', reason: 'Removing old Drive versions is not built yet.' });
  const report = { id: newId('deletion'), at, sourceId, rows };
  await host.store.update(state => { (tools(state).deletions ??= []).push(report); });
  return report;
}

export function deletions(state: State) { return { items: [...(tools(state).deletions ?? [])].reverse() }; }

const cell = (value: string) => { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export async function exportDeletion(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id } = fields(payload, ['id']);
  const report = (tools(host.store.read()).deletions ?? []).find((item: any) => item.id === id);
  check(typeof id === 'string' && report, 'NOT_FOUND', 'That deletion report was not found.');
  const csv = ['report,deleted_at,source,place,state,reason', ...report.rows.map((row: Row) => [report.id, report.at, report.sourceId, row.place, row.state, row.reason].map(cell).join(','))].join('\n') + '\n';
  const folder = join(host.directory, 'exports', 'deletions'); await mkdir(folder, { recursive: true });
  const name = `${report.id}.csv`; const path = join(folder, name);
  await writeFile(path, csv, { encoding: 'utf8', mode: 0o600 });
  return { name, path, bytes: Buffer.byteLength(csv), sha256: sha256(csv) };
}
