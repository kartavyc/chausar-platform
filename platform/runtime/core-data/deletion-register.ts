/**
 * The deletion register (WK-15, TR-13): what was deleted, kept OUTSIDE the vault so a restore of an
 * older vault cannot forget it. One file per workspace in `<app directory>/deletions/`. It never holds a
 * name or a raw id: each entry is a keyed hash over the workspace id, the kind and the id, with the kind
 * and the time of the deletion. Writes are atomic (a fresh temporary file, flushed, then renamed) and
 * synchronous, so a write never interleaves with another inside this process; the vault's writer lock
 * keeps a second process off the same workspace. A file that is not exactly this shape is refused.
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { check, hash, now, type State, type StateStore } from '../contracts.ts';
import { moduleState } from '../modules/types.ts';

export type DeletionKind = 'customer' | 'source';
/**
 * `rows` (customer entries): keyed hashes of the exact rows that were deleted, so a restore is checked against
 * what was really removed and never against rows the person could not delete; `null` when there were more
 * than the limit, and the customer's older rows are then checked by the customer's own key.
 */
export type RegisterEntry = { key: string; kind: DeletionKind; at: string; rows?: string[] | null };
type Register = { version: 1; workspace: string; entries: RegisterEntry[] };
export const REGISTER_LIMITS = Object.freeze({ entries: 20000, rows: 5000, bytes: 16 * 1024 * 1024, outbox: 2000 });
const KINDS: readonly DeletionKind[] = ['customer', 'source'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const WORKSPACE = /^[A-Za-z0-9_-]{1,128}$/;

/** The keyed hash that stands for one deleted thing. Workspace ids are random, so equal ids in two workspaces never match. */
export const registerKey = (workspaceId: string, kind: DeletionKind, id: string) => hash(JSON.stringify(['chausar-deletion-register-v1', workspaceId, kind, id]));
/** The shorter keyed hash that stands for one deleted row (a fact, receipt, answer, action or conversation id). */
export const rowKey = (workspaceId: string, rowId: string) => hash(JSON.stringify(['chausar-deletion-register-v1', workspaceId, 'row', rowId])).slice(0, 32);

/** Where each open store's application directory is: bound by the module host, or the folder above a vault's own folder. */
const bound = new WeakMap<object, string>();
export function bindRegisterDirectory(store: object, directory: string): void { if (typeof directory === 'string' && directory.length > 0) bound.set(store, directory); }
function directoryOf(store: object): string | undefined {
  const known = bound.get(store); if (known) return known;
  const own = (store as { directory?: unknown }).directory;
  return typeof own === 'string' && own.length > 0 ? dirname(own) : undefined;
}

function registerFile(directory: string, workspaceId: string) {
  check(WORKSPACE.test(workspaceId), 'DELETION_REGISTER_INVALID', 'This workspace cannot keep a deletion register.');
  let root: string; try { root = realpathSync.native(directory); } catch { check(false, 'DELETION_REGISTER_UNAVAILABLE', 'The deletion register folder is not available.'); }
  const folder = join(root, 'deletions'), name = `register-${hash(workspaceId).slice(0, 32)}.json`, file = join(folder, name);
  check(relative(folder, file) === name, 'DELETION_REGISTER_INVALID', 'The deletion register must stay in its folder.');
  return { folder, file };
}
function empty(workspaceId: string): Register { return { version: 1, workspace: hash(workspaceId), entries: [] }; }

/** Reads the register, or an empty one when none was written yet. Anything malformed is refused, never repaired. */
export function readRegister(directory: string, workspaceId: string): RegisterEntry[] {
  const { file } = registerFile(directory, workspaceId); let text: string;
  try {
    const stat = lstatSync(file);
    check(stat.isFile() && stat.size <= REGISTER_LIMITS.bytes, 'DELETION_REGISTER_INVALID', 'The deletion register is not a file of the expected size.');
    text = readFileSync(file, 'utf8');
  } catch (error) { if ((error as { code?: unknown })?.code === 'ENOENT') return []; throw error; }
  let value: unknown; try { value = JSON.parse(text); } catch { check(false, 'DELETION_REGISTER_INVALID', 'The deletion register cannot be read.'); }
  const record = value as Register;
  check(!!record && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).sort().join() === 'entries,version,workspace'
    && record.version === 1 && record.workspace === hash(workspaceId) && Array.isArray(record.entries) && record.entries.length <= REGISTER_LIMITS.entries, 'DELETION_REGISTER_INVALID', 'The deletion register is not in the expected form.');
  const seen = new Set<string>();
  for (const entry of record.entries) {
    const keys = !!entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.keys(entry).sort().join() : '';
    check((keys === 'at,key,kind' || keys === 'at,key,kind,rows' && entry.kind === 'customer') && typeof entry.key === 'string' && /^[0-9a-f]{64}$/.test(entry.key)
      && KINDS.includes(entry.kind) && typeof entry.at === 'string' && ISO.test(entry.at) && Number.isFinite(Date.parse(entry.at)) && !seen.has(`${entry.kind}:${entry.key}`)
      && (entry.rows === undefined || entry.rows === null || Array.isArray(entry.rows) && entry.rows.length <= REGISTER_LIMITS.rows && entry.rows.every(r => typeof r === 'string' && /^[0-9a-f]{32}$/.test(r)) && new Set(entry.rows).size === entry.rows.length),
      'DELETION_REGISTER_INVALID', 'The deletion register is not in the expected form.');
    seen.add(`${entry.kind}:${entry.key}`);
  }
  return record.entries.map(e => ({ key: e.key, kind: e.kind, at: e.at, ...(e.rows === undefined ? {} : { rows: e.rows === null ? null : [...e.rows] }) }));
}

function writeAtomic(folder: string, file: string, body: string) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temporary = join(folder, `.register-${randomUUID()}.tmp`); let handle: number | undefined;
  try {
    handle = openSync(temporary, 'wx', 0o600); writeSync(handle, body); fsyncSync(handle); closeSync(handle); handle = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (handle !== undefined) try { closeSync(handle); } catch { /* already failing */ }
    try { unlinkSync(temporary); } catch { /* nothing was left */ }
    throw error;
  }
  // The rename is durable once the folder is flushed; some systems cannot open a folder for that.
  try { const folderHandle = openSync(folder, 'r'); try { fsyncSync(folderHandle); } finally { closeSync(folderHandle); } } catch { /* best effort */ }
}

function mergeRows(left: string[] | null | undefined, right: string[] | null | undefined): string[] | null | undefined {
  if (left === undefined) return right; if (right === undefined) return left; if (left === null || right === null) return null;
  const rows = [...new Set([...left, ...right])]; return rows.length <= REGISTER_LIMITS.rows ? rows : null;
}
/** Adds (or moves forward) entries; refuses when the register is full rather than forgetting an older deletion. */
export function addToRegister(directory: string, workspaceId: string, items: readonly { kind: DeletionKind; id: string; at: string; rowIds?: readonly string[] }[]): RegisterEntry[] {
  const { folder, file } = registerFile(directory, workspaceId); const entries = readRegister(directory, workspaceId);
  for (const item of items) {
    const key = registerKey(workspaceId, item.kind, item.id); const existing = entries.find(e => e.kind === item.kind && e.key === key);
    const rows = item.rowIds === undefined ? undefined : mergeRows([], [...new Set(item.rowIds.map(id => rowKey(workspaceId, id)))]);
    if (existing) { if (item.at > existing.at) existing.at = item.at; const merged = mergeRows(existing.rows, rows); if (merged !== undefined) existing.rows = merged; continue; }
    check(entries.length < REGISTER_LIMITS.entries, 'DELETION_REGISTER_FULL', 'The deletion register is full. Nothing was deleted.');
    entries.push({ key, kind: item.kind, at: item.at, ...(rows === undefined ? {} : { rows }) });
  }
  const body = `${JSON.stringify({ ...empty(workspaceId), entries })}\n`;
  check(Buffer.byteLength(body) <= REGISTER_LIMITS.bytes, 'DELETION_REGISTER_FULL', 'The deletion register is full. Nothing was deleted.');
  writeAtomic(folder, file, body);
  return entries;
}

/** This part's private state inside the vault: the outbox holds register entries that could not be written yet. */
export type DataState = { outbox: RegisterEntry[]; exports: string[] };
export function dataState(state: State): DataState {
  const lane = moduleState<Record<string, unknown>>(state, 'core-data', () => ({}));
  const data = (lane.data ??= { outbox: [], exports: [] }) as DataState;
  if (!Array.isArray(data.outbox)) data.outbox = []; if (!Array.isArray(data.exports)) data.exports = [];
  return data;
}
export function peekDataState(state: State): DataState | undefined {
  const data = (state.extensions?.['core-data'] as Record<string, unknown> | undefined)?.data as DataState | undefined;
  return data && Array.isArray(data.outbox) && Array.isArray(data.exports) ? data : undefined;
}

/**
 * Called by the trust service inside the source-deletion transaction. The entry is written to the register
 * file at once; when no application folder is known or the file cannot be written, it waits in the vault's
 * outbox and the next deletion method writes it out. A source deletion is never refused for the register.
 */
export function noteSourceDeletion(store: StateStore, state: State, sourceId: string): void {
  const at = now(), directory = directoryOf(store);
  if (directory) try { addToRegister(directory, state.workspace.id, [{ kind: 'source', id: sourceId, at }]); return; } catch { /* kept in the outbox below */ }
  const outbox = dataState(state).outbox, key = registerKey(state.workspace.id, 'source', sourceId);
  const existing = outbox.find(e => e.kind === 'source' && e.key === key);
  if (existing) existing.at = at; else { outbox.push({ key, kind: 'source', at }); if (outbox.length > REGISTER_LIMITS.outbox) outbox.splice(0, outbox.length - REGISTER_LIMITS.outbox); }
}

/** Register entries plus anything still waiting in the outbox (by key, the later time wins). */
export function registerEntries(directory: string, state: State): RegisterEntry[] {
  const entries = readRegister(directory, state.workspace.id);
  for (const waiting of peekDataState(state)?.outbox ?? []) {
    const existing = entries.find(e => e.kind === waiting.kind && e.key === waiting.key);
    if (!existing) entries.push({ ...waiting }); else if (waiting.at > existing.at) existing.at = waiting.at;
  }
  return entries;
}
/** Writes outbox entries to the register file (inside a store update); the outbox is emptied only once the file holds them. */
export function flushOutbox(directory: string, state: State): void {
  const data = peekDataState(state); if (!data?.outbox.length) return;
  const { folder, file } = registerFile(directory, state.workspace.id); const entries = readRegister(directory, state.workspace.id);
  for (const waiting of data.outbox) {
    const existing = entries.find(e => e.kind === waiting.kind && e.key === waiting.key);
    if (existing) { if (waiting.at > existing.at) existing.at = waiting.at; continue; }
    check(entries.length < REGISTER_LIMITS.entries, 'DELETION_REGISTER_FULL', 'The deletion register is full. Nothing was deleted.');
    entries.push({ ...waiting });
  }
  writeAtomic(folder, file, `${JSON.stringify({ ...empty(state.workspace.id), entries })}\n`);
  data.outbox = [];
}
