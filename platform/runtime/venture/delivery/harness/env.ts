// Chausar delivery harness: puts a run's tool environment together from the vault, for a rehearsal episode or a
// real order resumed after each approval. Reads only; tables and receipts the tools make are stored by the caller.
import { check, type Context, type State } from '../../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import type { HarnessState, PlaybookRecord, UploadRecord, VentureDeps, VentureRecord, WorkReceiptRecord, WorkRunRef, WorkTableRecord } from '../../contracts.ts';
import type { DelegateAvailability } from './delegate.ts';
import { dictionaryEntries, ownerDefinitions } from './dictionary.ts';
import { tablesOfFile, type FileLike } from './files.ts';
import type { ToolEnv } from './tools.ts';

/** The order's files, oldest first. */
export function orderUploads(state: State, ventureId: string, orderId: string): UploadRecord[] {
  return listRecords(state, 'venture-upload', ventureId).filter(upload => upload.scope.kind === 'order' && upload.scope.orderId === orderId);
}

/** Stored uploads by id, in the order given. A missing one is refused. */
export function uploadsById(state: State, ventureId: string, ids: readonly string[]): FileLike[] {
  return ids.map(id => {
    const upload = findRecord(state, 'venture-upload', id);
    check(upload && upload.ventureId === ventureId, 'UPLOAD_NOT_FOUND', 'A file this run reads is gone.');
    return upload;
  });
}

/** The tables and work receipts a run already made, in the order they were made. */
export function madeSoFar(state: State, harness: HarnessState): { tables: WorkTableRecord[]; receipts: WorkReceiptRecord[] } {
  const tables = harness.tableIds.map(id => findRecord(state, 'venture-work-table', id));
  const receipts = harness.workReceiptIds.map(id => findRecord(state, 'venture-work-receipt', id));
  check(tables.every(Boolean) && receipts.every(Boolean), 'WORK_RECEIPT_NOT_FOUND', 'A table or receipt this run made is gone.');
  return { tables: tables as WorkTableRecord[], receipts: receipts as WorkReceiptRecord[] };
}

export type EnvInput = {
  deps: VentureDeps;
  ctx: Context;
  state: State;
  venture: VentureRecord;
  playbook: PlaybookRecord;
  runRef: WorkRunRef;
  files: FileLike[];
  tables?: WorkTableRecord[];
  receipts?: WorkReceiptRecord[];
  allowed: readonly string[];
  /** The owner's command-line tools found and checked for this turn; real orders only. */
  delegateOffer?: readonly DelegateAvailability[];
};

export function buildToolEnv(input: EnvInput): ToolEnv {
  const { deps, ctx, state, venture } = input;
  return {
    deps, ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, currency: venture.country.currency, dateOrder: venture.country.dateOrder,
    runRef: input.runRef, files: input.files, tables: [...(input.tables ?? [])], receipts: [...(input.receipts ?? [])],
    dictionary: dictionaryEntries(state, venture, input.playbook.aliases ?? {}, ownerDefinitions(deps, ctx)),
    sandbox: deps.sandbox, now: () => deps.clock().toISOString(), allowed: [...input.allowed], delegateOffer: [...(input.delegateOffer ?? [])],
  };
}

/** A readable name for a file, a sheet of a file, or a table a tool made; for the proven list. */
export function namer(env: Pick<ToolEnv, 'files' | 'tables'>): (id: string) => string {
  return id => {
    const file = env.files.find(item => item.id === id);
    if (file) return file.name;
    const sheetOwner = env.files.find(item => id.startsWith(`${item.id}.s`));
    if (sheetOwner) {
      try { return tablesOfFile(sheetOwner).find(table => table.id === id)?.name ?? sheetOwner.name; } catch { return sheetOwner.name; }
    }
    const table = env.tables.find(item => item.id === id);
    return table ? `the table ${table.name}` : 'a file';
  };
}

/** The files as the loop lists them to the agent: alias, name and format. */
export function fileList(files: readonly FileLike[]): { file: string; name: string; format: FileLike['format'] }[] {
  return files.map((file, index) => ({ file: `f${index + 1}`, name: file.name, format: file.format }));
}
