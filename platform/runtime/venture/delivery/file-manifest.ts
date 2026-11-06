// Chausar venture launcher, delivery (Ink v2 wave 4, package 4J1; catalogue J2): an approval bound to the bytes of the
// files it covers. Accept or an edit of a draft that hands over files (the attachments, tables and receipts its run
// made) stores a manifest: each file's id and the sha256 of its bytes, with who decided and when (deliveryReviewHandler
// in runs.ts). A later share link or post of those files checks it (shareCreate, proposePost): any byte that differs, a
// file that is gone, or one the owner never saw is FILE_CHANGED. A new render clears the acceptance, so the draft returns
// to Today for review as a new row (refuseChangedFiles, views/queue.ts). Only the owner's principal accepts: the review
// method is app only and approve level, and its exact payload has no field that could say who approved. The client's
// own files the run only read are not handed over, so they are not in the manifest. Nothing here is a model's.
// The per-format manifest and the refusal on changed bytes follow JobOS state_store.py (trust in a request field as a
// trap); a rewrite, not a copy.
import { createHash } from 'node:crypto';
import { ChausarError, type Context, type State } from '../../contracts.ts';
import { digest, findRecord, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, FileManifest, IsoTime, VentureDeps } from '../contracts.ts';

export const FILE_CHANGED_WORDS = 'A file in this draft changed after you accepted it, so nothing was shared, posted or sent. It is back on Today for you to review.';

/** The fields every record has that are not its bytes. */
const RECORD_BASE = new Set(['id', 'kind', 'ventureId', 'memberId', 'epoch', 'at']);

/**
 * The sha256 of one file's bytes, or null when it is gone: a table is its name, columns and rows as handed over; a work
 * receipt is everything it states; an upload is its stored bytes.
 */
export function fileSha(state: State, ventureId: string, fileId: string): string | null {
  const table = findRecord(state, 'venture-work-table', fileId);
  if (table && table.ventureId === ventureId) return digest({ name: table.name, columns: table.columns, rows: table.rows });
  const receipt = findRecord(state, 'venture-work-receipt', fileId);
  if (receipt && receipt.ventureId === ventureId) return digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => !RECORD_BASE.has(key))));
  const upload = findRecord(state, 'venture-upload', fileId);
  if (upload && upload.ventureId === ventureId) return createHash('sha256').update(Buffer.from(upload.contentBase64, 'base64')).digest('hex');
  return null;
}

/** The files a draft hands over: what its run made (tables, work receipts) and what the draft attaches. Never the client's own files. */
export function handedOver(state: State, run: DeliveryRunRecord): string[] {
  const ids = new Set<string>([...(run.harness?.tableIds ?? []), ...(run.harness?.workReceiptIds ?? []), ...(run.deliverable?.attachments ?? []).map(item => item.receiptId)]);
  const mine = (ref: { kind: string; runId?: string }) => ref.kind === 'delivery' && ref.runId === run.id;
  for (const table of listRecords(state, 'venture-work-table', run.ventureId)) if (mine(table.runRef)) ids.add(table.id);
  for (const receipt of listRecords(state, 'venture-work-receipt', run.ventureId)) if (mine(receipt.runRef)) ids.add(receipt.id);
  return [...ids].sort();
}

/** Each handed-over file's sha256 as it is now; a file that is gone is left out. */
export function manifestOf(state: State, run: DeliveryRunRecord): Record<string, string> {
  const files: Record<string, string> = {};
  for (const id of handedOver(state, run)) {
    const sha = fileSha(state, run.ventureId, id);
    if (sha !== null) files[id] = sha;
  }
  return files;
}

/** The manifest an Accept stores, or null when the draft hands over no file (its words are bound by its digest already). */
export function acceptManifest(state: State, run: DeliveryRunRecord, at: IsoTime, by: string): FileManifest | null {
  const files = manifestOf(state, run);
  return Object.keys(files).length ? { files, at, by } : null;
}

/** The verdicts that hand files over: the owner accepted the draft, or edited it into their own version. */
const BOUND: readonly DeliveryRunRecord['status'][] = ['accepted', 'edited'];

/**
 * The files of an accepted or edited draft the owner did not see as they are now: bytes that differ from the manifest,
 * a file that is gone, and a handed-over file the manifest does not name (all of them when there is no manifest).
 * Nothing for a draft not yet accepted: nothing of it is bound.
 */
export function changedFiles(state: State, run: DeliveryRunRecord): string[] {
  if (!BOUND.includes(run.status)) return [];
  const files = run.manifest?.files ?? {};
  const changed = new Set(Object.entries(files).filter(([id, sha]) => fileSha(state, run.ventureId, id) !== sha).map(([id]) => id));
  for (const id of handedOver(state, run)) if (!Object.hasOwn(files, id)) changed.add(id);
  return [...changed].sort();
}

/** Before a share, post or send of a draft's files: FILE_CHANGED when any of them is not what the owner accepted. */
export function checkManifest(state: State, run: DeliveryRunRecord): void {
  if (changedFiles(state, run).length) throw new ChausarError('FILE_CHANGED', FILE_CHANGED_WORDS);
}

/**
 * A new render changed files the owner accepted or edited: the acceptance is cleared inside the caller's transaction and
 * the draft waits for review again, with a reopen mark that gives Today's review row a new version (the row the owner
 * decided stays decided). The owner's edited words are kept on the record. True when it was cleared.
 */
export function clearChangedAcceptance(tx: VentureTx, runId: string): boolean {
  const run = tx.find('venture-delivery-run', runId);
  const changed = run ? changedFiles(tx.state, run) : [];
  if (!run || !changed.length) return false;
  tx.replace<DeliveryRunRecord>({
    ...run, status: 'ready-for-review', verdict: null, manifest: null,
    reopened: { count: (run.reopened?.count ?? 0) + 1, at: tx.now, files: changed },
  });
  tx.emit('delivery-ready', { runId });
  tx.emit('run.waiting', { runId });
  return true;
}

/**
 * For a caller about to share, post or send a draft's files, before its own transaction: when any file changed since
 * Accept, the acceptance is cleared (committed on its own, so Today shows the draft again) and FILE_CHANGED is thrown.
 */
export async function refuseChangedFiles(deps: VentureDeps, ctx: Context, runId: string): Promise<void> {
  const run = findRecord(deps.store.read(), 'venture-delivery-run', runId);
  if (!run || !changedFiles(deps.store.read(), run).length) return;
  await ventureAction(deps, ctx, 'prepare', 'delivery.files-changed', tx => { clearChangedAcceptance(tx, runId); });
  throw new ChausarError('FILE_CHANGED', FILE_CHANGED_WORDS);
}
