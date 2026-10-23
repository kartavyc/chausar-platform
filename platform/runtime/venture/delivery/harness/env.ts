// Chausar delivery harness: puts a run's tool environment together from the vault, for a rehearsal episode or a
// real order resumed after each approval. Reads only; tables and receipts the tools make are stored by the caller.
import { check, type Context, type State } from '../../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import type { HarnessState, OrderIntake, PlaybookRecord, UploadRecord, VentureDeps, VentureRecord, WorkReceiptRecord, WorkRunRef, WorkTableRecord } from '../../contracts.ts';
import { REHEARSAL, type RateUse } from '../../playbooks/ca-firm/rates.ts';
import { rateUseFor } from '../../playbooks/ca-firm/signoff.ts';
import type { DelegateAvailability } from './delegate.ts';
import { dictionaryEntries, ownerDefinitions } from './dictionary.ts';
import { tablesOfFile, type FileLike } from './files.ts';
import type { ToolEnv } from './tools.ts';
import { recheckRun } from './recheck.ts';
import { harnessPolicyContext } from '../../policy/context.ts';
import type { Approval } from '../../policy/ladder.ts';
import { screenSettingOf } from '../../policy/untrusted-methods.ts';

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
  /** Who approved this turn. A real order's caller says so; without it the policy has no approval and holds every call. */
  approval?: Approval;
  /** The order's intake; absent or null in rehearsals and improvement runs, whose practice clients record none. */
  intake?: OrderIntake | null;
  /**
   * How the CA firm's tax engines may use rate tables. Absent: a real order needs the CA's confirmation of each table
   * version (rateUseFor 'client'), and a rehearsal or improvement run works on unconfirmed tables (REHEARSAL).
   */
  rateUse?: RateUse;
};

export function buildToolEnv(input: EnvInput): ToolEnv {
  const { deps, ctx, state, venture } = input;
  const runRef = input.runRef;
  return {
    deps, ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, currency: venture.country.currency, dateOrder: venture.country.dateOrder,
    runRef: input.runRef, files: input.files, tables: [...(input.tables ?? [])], receipts: [...(input.receipts ?? [])],
    dictionary: dictionaryEntries(state, venture, input.playbook.aliases ?? {}, ownerDefinitions(deps, ctx)),
    sandbox: deps.sandbox, now: () => deps.clock().toISOString(), allowed: [...input.allowed], delegateOffer: [...(input.delegateOffer ?? [])],
    policy: { context: harnessPolicyContext({ state, venture, playbook: input.playbook, runRef: input.runRef, ...(input.approval ? { approval: input.approval } : {}) }) },
    // The business's untrusted screen: its mode (observe until the owner turns on enforce) and what the owner released.
    screen: screenSettingOf(state, venture.id),
    // Only a real order journals anything (shadow entries at shadow), as the person who approved the turn.
    ...(input.runRef.kind === 'delivery' ? { ctx } : {}),
    // A real order's approved calls read the order, the client, the stage and the run's cap again just before they run.
    ...(runRef.kind === 'delivery' ? { recheck: () => recheckRun(deps, venture.id, runRef.runId) } : {}),
    intake: input.intake ?? null,
    rateUse: input.rateUse ?? (runRef.kind === 'delivery' ? rateUseFor(state, venture.id, 'client') : REHEARSAL),
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
