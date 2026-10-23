// AI-native CA firm: a delivery run for a regulated offer asks the CA of record to sign off its papers. delivery/runs.ts
// calls requestSignoffForRun after a run reaches 'ready-for-review', and again after the owner edits it (the edit is new
// papers); naming a CA of record sweeps ready papers that have no request (sweepSignoffRequests); and a held draft row
// on Today sends its papers to the CA in one click (sendRunToCa). This file decides whether the run's papers are
// regulated and puts them in front of the CA (signoff.ts). Asking never undoes or fails the run: whatever goes wrong
// leaves the draft as it is. Until the CA signs, the papers can't be accepted, shared or posted (signoff-gate.ts).
//
// When it asks:
// - the business's idea picks the AI-native CA firm playbook, and a CA of record is named;
// - the order's offer is one of the playbook's regulated offers (signoff-gate.ts regulatedPapersOf): GST and TDS
//   workings, income tax returns, notice replies and papers for a tax audit;
// - the papers are ready: an agent draft at approve each whose checks passed, or the owner's edit of one. A practice
//   draft, a draft with a failed check, and a template outline (which never read the client's request) are not papers yet.
// A run asks once for each version of its papers: requestCaSignoff returns the earlier request for the same digest.
import { ChausarError, type Context, type State } from '../../../contracts.ts';
import type { DeliveryRunRecord, DeliveryRunView, VentureDeps, VentureRecord } from '../../contracts.ts';
import { findRecord, listRecords, readVenture } from '../../records.ts';
import { runView } from '../../delivery/runs.ts';
import { caLabel } from './playbook.ts';
import { papersDigest, regulatedPapersOf, signoffStage } from './signoff-gate.ts';
import { caOfRecord, requestCaSignoff, sendToCa } from './signoff.ts';

export { caOfferOf } from './signoff-gate.ts';

const RECEIPT_ID = /^[A-Za-z0-9_.:-]{3,80}$/;

/** Are these the run's papers, ready to go to the CA? Ready and passing its checks, or the owner's edit; never practice. */
function papersReady(run: DeliveryRunRecord, venture: VentureRecord, nowMs: number): boolean {
  if (run.practice) return false;
  if (run.status === 'edited') return !!run.editedText;
  // Read without the vault, the run's view leaves the CA's sign-off out: could the owner accept it but for that?
  return run.status === 'ready-for-review' && run.servedBy === 'model' && runView(run, venture, nowMs).canAccept;
}

/** True when a run's papers are ready for the CA and have not gone to them yet: Today offers Send to CA. */
export function waitsToGoToCa(state: State, venture: VentureRecord, run: DeliveryRunRecord, nowMs: number): boolean {
  if (!papersReady(run, venture, nowMs)) return false;
  const stage = signoffStage(state, venture, run);
  return stage === 'not-asked' || stage === 'unsent';
}

/**
 * Puts a run's papers in front of the CA of record when the run is regulated CA firm work. Returns the request id it
 * made or found, or null when the run is not regulated work or anything stopped it. Never throws.
 */
export async function requestSignoffForRun(deps: VentureDeps, ctx: Context, run: Pick<DeliveryRunView, 'id' | 'orderId'>): Promise<string | null> {
  try {
    const { state, venture } = readVenture(deps, ctx);
    if (!caOfRecord(state, venture.id)) return null;
    const stored = findRecord(state, 'venture-delivery-run', run.id);
    const order = findRecord(state, 'venture-order', run.orderId);
    if (!stored || stored.ventureId !== venture.id || !order || order.ventureId !== venture.id) return null;
    if (!papersReady(stored, venture, deps.clock().getTime())) return null;
    const papers = regulatedPapersOf(state, venture, order.id);
    if (!papers) return null;
    const client = findRecord(state, 'venture-client', order.clientId);
    const clientName = client && client.ventureId === venture.id ? client.name.slice(0, 120) : null;
    const title = `${papers.offer.name}${clientName ? ` for ${clientName}` : ''}${stored.status === 'edited' ? ', your edit' : ''}`.slice(0, 140);
    const receiptIds = [order.priceReceiptId, ...(stored.harness?.workReceiptIds ?? [])].filter(id => RECEIPT_ID.test(id)).slice(0, 50);
    if (!receiptIds.length) return null;
    const request = await requestCaSignoff(deps, ctx, {
      subjectKind: papers.subjectKind, title, clientName, workingDigest: papersDigest(stored),
      receiptIds, playbookHash: /^[a-f0-9]{64}$/.test(stored.playbookHash) ? stored.playbookHash : null, deliveryId: stored.id,
    });
    return request.id;
  } catch {
    // The draft stands as it is: asking the CA is never a reason for the run itself to fail.
    return null;
  }
}

/** Asks for the sign-off every ready run's papers are missing, oldest first. Run after a CA of record is named. Never throws. */
export async function sweepSignoffRequests(deps: VentureDeps, ctx: Context): Promise<string[]> {
  try {
    const { state, venture } = readVenture(deps, ctx);
    const nowMs = deps.clock().getTime();
    const waiting = listRecords(state, 'venture-delivery-run', venture.id)
      .filter(run => papersReady(run, venture, nowMs) && signoffStage(state, venture, run) === 'not-asked');
    const asked: string[] = [];
    for (const run of waiting) {
      const id = await requestSignoffForRun(deps, ctx, run);
      if (id) asked.push(id);
    }
    return asked;
  } catch {
    return [];
  }
}

/** Today's Send to CA on a held draft: asks for the sign-off if none was asked, and sends the papers to the CA of record. */
export async function sendRunToCa(deps: VentureDeps, ctx: Context, runId: string): Promise<{ line: string }> {
  const { state } = readVenture(deps, ctx);
  const run = findRecord(state, 'venture-delivery-run', runId);
  const requestId = run ? await requestSignoffForRun(deps, ctx, run) : null;
  if (!requestId) throw new ChausarError('SIGNOFF_NOT_FOUND', 'These papers cannot go to your CA yet. Read the draft for why.');
  const { ca } = await sendToCa(deps, ctx, [requestId]);
  return { line: `Waiting for ${caLabel(ca)} to sign off.` };
}
