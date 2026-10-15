/**
 * TL-03 The follow-up book: delete one entry and export the book, "like anything else".
 *
 * The book itself is models-ext's (`smallapps.records.*`, kept under that module's namespace as
 * `smallApps.book`, shape in `smallapps/book.ts`). models-ext has no delete or export, and round 4
 * gives both to this lane, so these two methods work on that namespace through the book's own
 * visibility rules and nothing else:
 *
 * - `trustx.followUpDelete {id, expectedVersion}`: deleting waits for a person, so it runs only in
 *   the desktop app, from a request that has read no outside text, for the person who wrote the
 *   entry or an owner or cofounder, against the version they read. The entry goes with its whole
 *   history; the audit line names the entry id only, never what was written.
 * - `trustx.followUpExport {}`: the entries the caller may see now (latest version) as a CSV file
 *   on this computer, cells guarded against spreadsheet formulas. Exported files are not encrypted.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit, check, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { visible, visibleVersions } from '../smallapps/book.ts';
import type { Entry } from '../smallapps/book.ts';
import { fields, sha256 } from './tools-common.ts';

/** models-ext's module id, where the book lives. */
const BOOK_MODULE = 'models-ext';

function peekBook(state: State): Entry[] {
  const ns = peekModuleState<Record<string, any>>(state, BOOK_MODULE);
  const book = ns?.smallApps?.book;
  return Array.isArray(book) ? book as Entry[] : [];
}

const cell = (value: string) => { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

function inApp(ctx: Context) {
  check(ctx.channel === undefined || ctx.channel === 'desktop', 'FOLLOW_UP_APP_ONLY', 'Delete and export follow-ups inside the desktop app.');
  check(!ctx.sourceTainted, 'FOLLOW_UP_TAINTED_CONTEXT', 'A request that has read outside text cannot delete or export follow-ups.');
}

export async function followUpDelete(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id, expectedVersion } = fields(payload, ['id', 'expectedVersion']);
  inApp(ctx);
  check(typeof id === 'string' && id.length > 0 && id.length <= 200 && Number.isSafeInteger(expectedVersion), 'FOLLOW_UP_INVALID', 'Name the follow-up and the version you read.');
  return host.store.update(state => {
    const book = peekBook(state); const entry = book.find(item => item.id === id);
    check(entry && visible(state, ctx, entry), 'FOLLOW_UP_NOT_FOUND', 'This follow-up is unavailable.');
    check(entry.createdBy === ctx.memberId || ctx.role === 'owner' || ctx.role === 'cofounder', 'FOLLOW_UP_FORBIDDEN', 'Only the person who wrote this follow-up or an owner can delete it.');
    check(entry.versions.at(-1)!.version === expectedVersion, 'FOLLOW_UP_CONFLICT', 'This follow-up changed since you read it. Read it again.');
    const ns = moduleState<Record<string, any>>(state, BOOK_MODULE, () => ({}));
    ns.smallApps.book = (ns.smallApps.book as Entry[]).filter(item => item.id !== id);
    audit(state, 'smallapp.followup.deleted', { entryId: id, versions: entry.versions.length, by: ctx.memberId });
    return { deleted: true, id, versionsRemoved: entry.versions.length };
  });
}

export async function followUpExport(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  inApp(ctx);
  const state = host.store.read();
  const rows = peekBook(state).filter(entry => visible(state, ctx, entry)).map(entry => ({ entry, latest: entry.versions.at(-1)!, withheld: visibleVersions(state, ctx, entry).withheld }))
    .sort((a, b) => a.latest.when.localeCompare(b.latest.when) || a.entry.id.localeCompare(b.entry.id));
  const csv = ['entry,customer,written,said,next,status,version,earlier_versions_withheld',
    ...rows.map(({ entry, latest, withheld }) => [entry.id, latest.who, latest.at.slice(0, 10), latest.said, latest.when, latest.status, String(latest.version), String(withheld)].map(cell).join(','))].join('\n') + '\n';
  const folder = join(host.directory, 'exports', 'follow-up'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = `${newId('followup-export')}.csv`; const path = join(folder, name);
  await writeFile(path, csv, { encoding: 'utf8', mode: 0o600 });
  await host.store.update(next => { audit(next, 'smallapp.followup.exported', { rows: rows.length, by: ctx.memberId }); });
  return { name, path, bytes: Buffer.byteLength(csv), sha256: sha256(csv), rows: rows.length, encrypted: false, warning: 'Exported files are not encrypted.' };
}
