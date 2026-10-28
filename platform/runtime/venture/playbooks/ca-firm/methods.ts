// AI-native CA firm: venture.ca.get, venture.ca.setOfRecord, venture.ca.recordSignoff and venture.ca.confirmRates; and
// (Ink v2 2A2) venture.ca.receipt, a stored CA receipt worked again, and venture.ca.explainDiff, the CA's word on a
// difference from the portal.
// The CA place shows the CA of record, every rate-table version still waiting for the CA's confirmation, and the
// regulated papers the CA has in hand. The writes are the owner's clicks inside the app, each one recording what the
// CA did with the CA's own ICAI membership number; nothing here files, signs on a portal or sends anything outside
// Chausar (signoff.ts keeps the records and the rules).
//
// What the request list holds: papers once they were sent to the CA ('sent'), and papers the CA decided ('signed' or
// 'returned'). Papers not sent yet stay on Today as a Send to CA row until the owner sends them. The list follows
// delivery runs: each request names the run whose draft the papers are. A request made outside a run (none are in
// this build, but signoff.ts allows one) has no run to point at, so the list leaves it out and Today still shows it.
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, readVenture, requireAppChannel, singleLine } from '../../records.ts';
import type {
  CaDiffExplanation, CaFirmView, CaLatestPapers, CaPendingRate, CaReceiptView, CaRequestView, VentureDeps, VentureRecord, WorkReceiptRecord,
} from '../../contracts.ts';
import { RATE_TABLES, type Citation, type RateTable } from './rates.ts';
import { inr } from './money.ts';
import type { PortalDiff } from './portal.ts';
import { regulatedPapersOf } from './signoff-gate.ts';
import { CITATION_TABLE, citationTableHash, citationUseFor } from './citations.ts';
import { rederiveCaReceipt } from './stored-receipt.ts';
import {
  caOfRecord, confirmRateTables, diffExplanations, rateKey, recordCaSignoff, recordDiffExplanation, sendToCa, sentTo, setCaOfRecord, signoffFor,
  signoffRequests, unconfirmedRateTables, type DiffExplanation, type SignoffRequest,
} from './signoff.ts';

const MEMBERSHIP = "Type the CA's ICAI membership number.";

function citationLine(citation: Citation): string {
  const where = [citation.source, citation.part].filter(Boolean).join(', ');
  return citation.url ? `${where} (${citation.url})` : where;
}

function pendingRate(table: RateTable): CaPendingRate {
  return {
    tableId: table.id, title: table.title, version: String(table.version), validFrom: table.validFrom, validTo: table.validTo,
    citations: table.citations.map(citationLine),
  };
}

/**
 * One request as the CA place shows it, or null while it waits to be sent (it is on Today then). deliveryId is ''
 * only for a request made outside a delivery run, which the list leaves out (see the top of this file).
 */
function requestView(state: State, ventureId: string, request: SignoffRequest): CaRequestView | null {
  const decided = signoffFor(state, ventureId, request.id);
  const sent = sentTo(state, ventureId, request.id);
  if (!decided && !sent) return null;
  return {
    id: request.id, signoffId: decided?.id ?? null, deliveryId: request.deliveryId ?? '', title: request.title,
    state: decided ? decided.decision : 'sent', at: decided ? decided.at : sent!.at,
  };
}

/** A work receipt of this business that one of the CA firm's engines made, or null. */
function caReceiptOf(state: State, ventureId: string, id: string): WorkReceiptRecord | null {
  const found = findRecord(state, 'venture-work-receipt', id);
  return found && found.ventureId === ventureId && found.operation === 'ca.engine' && found.ca ? found : null;
}

/**
 * The newest regulated draft an agent made with the calculator's receipts (Ink v2 2A2), for Your CA to work each
 * receipt again. Practice drafts are never the CA's, so they are left out.
 */
function latestPapers(state: State, venture: VentureRecord): CaLatestPapers | null {
  const runs = listRecords(state, 'venture-delivery-run', venture.id)
    .filter(run => !run.practice && run.servedBy === 'model' && (run.status === 'ready-for-review' || run.status === 'accepted' || run.status === 'edited'))
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const run of runs) {
    const papers = regulatedPapersOf(state, venture, run.orderId);
    if (!papers) continue;
    const receiptIds = (run.harness?.workReceiptIds ?? []).filter(id => caReceiptOf(state, venture.id, id) !== null);
    if (!receiptIds.length) continue;
    const order = findRecord(state, 'venture-order', run.orderId);
    const client = order ? findRecord(state, 'venture-client', order.clientId) : undefined;
    const clientName = client && client.ventureId === venture.id ? client.name.slice(0, 120) : null;
    return { deliveryId: run.id, title: `${papers.offer.name}${clientName ? ` for ${clientName}` : ''}`, receiptIds };
  }
  return null;
}

function caView(state: State, venture: VentureRecord): CaFirmView {
  const ventureId = venture.id;
  const ca = caOfRecord(state, ventureId);
  const requests = signoffRequests(state, ventureId)
    .filter(request => typeof request.deliveryId === 'string' && request.deliveryId.length > 0)
    .map(request => requestView(state, ventureId, request))
    .filter((view): view is CaRequestView => view !== null)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    ca: ca ? { name: ca.name, membershipNo: ca.membershipNumber } : null,
    citations: { ...CITATION_TABLE, rows: [...CITATION_TABLE.rows], tableHash: citationTableHash(), confirmedBy: citationUseFor(state, ventureId, 'client').confirmedBy },
    pendingRates: unconfirmedRateTables(state, ventureId).map(pendingRate),
    requests,
    latestPapers: latestPapers(state, venture),
  };
}

function current(deps: VentureDeps, ctx: Context): CaFirmView {
  const { state, venture } = readVenture(deps, ctx);
  return caView(state, venture);
}

/** The typed membership number, spaces taken out; the records compare it with the CA the papers went to. */
function membershipNo(value: unknown): string {
  check(typeof value === 'string' && value.length <= 20, 'INVALID_VENTURE_REQUEST', MEMBERSHIP);
  const typed = (value as string).replace(/\s+/g, '');
  check(/^\d{1,12}$/.test(typed), 'INVALID_VENTURE_REQUEST', MEMBERSHIP);
  return typed;
}

/** venture.ca.get {} (read): the CA of record, rate tables waiting for the CA, and papers the CA has in hand. */
export async function caGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaFirmView> {
  exactPayload(payload ?? {}, []);
  return current(deps, ctx);
}

/**
 * venture.ca.setOfRecord { name, membershipNo } (approve, inside the app): names the CA of record. A newer one replaces
 * the older; what was signed stays signed by whoever signed it.
 */
export async function caSetOfRecord(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaFirmView> {
  requireAppChannel(ctx, 'venture.ca.setOfRecord');
  const body = exactPayload(payload, ['name', 'membershipNo'], ['name', 'membershipNo']);
  check(typeof body.membershipNo === 'string', 'INVALID_VENTURE_REQUEST', 'An ICAI membership number has six digits.');
  await setCaOfRecord(deps, ctx, { name: body.name, membershipNumber: (body.membershipNo as string).trim() });
  return current(deps, ctx);
}

/**
 * venture.ca.recordSignoff { requestId, membershipNo, note? } (approve, inside the app): the CA signs off papers that
 * were sent to them, by typing their own ICAI membership number. A number that is not theirs is refused
 * (CA_MEMBERSHIP_MISMATCH); papers not sent yet, or decided already, are refused (SIGNOFF_NOT_FOUND). Returning papers
 * stays on Today's row.
 */
export async function caRecordSignoff(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ request: CaRequestView }> {
  requireAppChannel(ctx, 'venture.ca.recordSignoff');
  const body = exactPayload(payload, ['requestId', 'membershipNo', 'note'], ['requestId', 'membershipNo']);
  const requestId = identifier(body.requestId, 'The papers');
  const number = membershipNo(body.membershipNo);
  const note = body.note === undefined || body.note === null || body.note === '' ? null : singleLine(body.note, 'Note', { min: 1, max: 400 });
  await recordCaSignoff(deps, ctx, { requestId, decision: 'signed', membershipNumber: number, note });
  const { state, venture } = readVenture(deps, ctx);
  const request = signoffRequests(state, venture.id).find(item => item.id === requestId);
  const view = request ? requestView(state, venture.id, request) : null;
  if (!view) throw new ChausarError('SIGNOFF_NOT_FOUND', 'Those papers are not waiting for a sign-off.');
  return { request: view };
}

const TABLE_REF = /^(in-[a-z0-9-]{1,60})(?:@(\d{1,4}))?$/;

/**
 * venture.ca.confirmRates { tableIds, membershipNo } (approve, inside the app): the CA of record confirms rate-table
 * versions by typing their ICAI membership number. A table id confirms every version of it still waiting
 * ('in-gst-rates'), or one version ('in-gst-rates@2'). Versions not yet sent to this CA are sent first, in the same
 * click, because the CA is the one confirming. The number is checked against the CA of record before anything is written.
 */
export async function caConfirmRates(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaFirmView> {
  requireAppChannel(ctx, 'venture.ca.confirmRates');
  const body = exactPayload(payload, ['tableIds', 'membershipNo'], ['tableIds', 'membershipNo']);
  const refs = body.tableIds;
  check(Array.isArray(refs) && refs.length >= 1 && refs.length <= 20 && refs.every(id => typeof id === 'string' && TABLE_REF.test(id)),
    'INVALID_VENTURE_REQUEST', 'Choose the rate tables to confirm.');
  const number = membershipNo(body.membershipNo);
  const { state, venture } = readVenture(deps, ctx);
  const ca = caOfRecord(state, venture.id);
  if (!ca) throw new ChausarError('CA_OF_RECORD_REQUIRED', 'Name your CA of record, with their ICAI membership number, first.');
  if (number !== ca.membershipNumber) throw new ChausarError('CA_MEMBERSHIP_MISMATCH', `That is not the ICAI membership number of ${ca.name}, your CA of record.`);

  const waiting = unconfirmedRateTables(state, venture.id);
  const chosen: RateTable[] = [];
  for (const ref of refs as string[]) {
    const [, id, version] = TABLE_REF.exec(ref)!;
    const matches = (table: RateTable) => table.id === id && (version === undefined || table.version === Number(version));
    check(RATE_TABLES.some(matches), 'SIGNOFF_NOT_FOUND', 'That rate table version is not one Chausar keeps.');
    for (const table of waiting) if (matches(table) && !chosen.includes(table)) chosen.push(table);
  }
  // Every chosen version is confirmed already: nothing to record.
  if (!chosen.length) return caView(state, venture);
  const keys = chosen.map(rateKey);
  // Sent to an older CA of record, or not sent: send to the CA confirming now, so the record names who confirmed.
  const unsent = keys.filter(key => sentTo(state, venture.id, key)?.membershipNumber !== ca.membershipNumber);
  if (unsent.length) await sendToCa(deps, ctx, unsent);
  await confirmRateTables(deps, ctx, { keys, membershipNumber: number });
  return current(deps, ctx);
}

// ---------------------------------------------------------------------------
// Stored CA receipts and the portal's differences (Ink v2 2A2)
// ---------------------------------------------------------------------------

const explanationView = (item: DiffExplanation): CaDiffExplanation => ({
  receiptId: item.receiptId, key: item.key, note: item.note, caName: item.caName, membershipNo: item.membershipNumber, at: item.at,
});

/**
 * venture.ca.receipt { id } (read): a stored CA receipt as the CA reads it (figures, steps, the rate tables it stamped,
 * assumptions, open questions, the CA's explanations of portal differences), and the engine worked again on its inputs
 * with those exact table versions (stored-receipt.ts): 'same', 'differs' with the first key that came out otherwise, or
 * 'table-gone'. A receipt that is not the CA firm calculator's, or not this business's, is CA_RECEIPT_NOT_FOUND.
 */
export async function caReceipt(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaReceiptView> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'The receipt');
  const { state, venture } = readVenture(deps, ctx);
  const receipt = caReceiptOf(state, venture.id, id);
  if (!receipt) throw new ChausarError('CA_RECEIPT_NOT_FOUND', "That receipt is not one of your CA firm's calculator receipts.");
  const ca = receipt.ca!;
  const { rederived, differs } = rederiveCaReceipt(receipt);
  const explanations = diffExplanations(state, venture.id, receipt.id);
  return {
    id: receipt.id, runId: receipt.runRef.kind === 'rehearsal' ? null : receipt.runRef.runId, engine: ca.engine,
    figures: receipt.figures.map(item => ({ key: item.key, label: item.label, display: item.display })),
    steps: (ca.steps ?? []).map(step => ({ key: step.key, label: step.label, display: step.display, section: step.section })),
    tables: ca.tables, assumptions: ca.assumptions, openQuestions: ca.openQuestions, rederived, differs,
    explanations: explanations.map(explanationView),
    ...(ca.engine === 'portal-diff' ? { portalDifferences: portalDifferences(ca.working as unknown as PortalDiff, explanations) } : {}),
  };
}

/** A portal diff's keys that are not the same, both sides as figures, each with the CA's explanation or null. */
function portalDifferences(diff: PortalDiff, explanations: readonly DiffExplanation[]): NonNullable<CaReceiptView['portalDifferences']> {
  return diff.rows.flatMap(row => (row.state === 'same' ? [] : [{
    key: row.key, label: row.label, state: row.state,
    ours: row.oursMinor === null ? null : inr(row.oursMinor), portal: row.portalMinor === null ? null : inr(row.portalMinor),
    explanation: explanations.find(item => item.key === row.key)?.note ?? null,
  }]));
}

/**
 * venture.ca.explainDiff { receiptId, key, note, membershipNo } (approve, inside the app): the CA of record explains one
 * difference between the portal's figures and the receipts, typing their own ICAI membership number (CA_NOT_OF_RECORD
 * otherwise). The run's portal-diff-explained check is worked again in the same write; papers that now pass all their
 * checks go in front of the CA for the sign-off, as any ready papers do (delivery-signoff.ts).
 */
export async function caExplainDiff(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ explanation: CaDiffExplanation }> {
  requireAppChannel(ctx, 'venture.ca.explainDiff');
  const body = exactPayload(payload, ['receiptId', 'key', 'note', 'membershipNo'], ['receiptId', 'key', 'note', 'membershipNo']);
  const receiptId = identifier(body.receiptId, 'The receipt');
  check(typeof body.key === 'string' && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(body.key), 'CA_DIFF_KEY_UNKNOWN', 'Name the difference by its key, such as net-payable.');
  const note = singleLine(body.note, 'Explanation', { min: 3, max: 400 });
  const number = membershipNo(body.membershipNo);
  const record = await recordDiffExplanation(deps, ctx, { receiptId, key: body.key as string, note, membershipNumber: number });
  const { state } = readVenture(deps, ctx);
  const receipt = findRecord(state, 'venture-work-receipt', receiptId);
  if (receipt?.runRef.kind === 'delivery') {
    const runId = receipt.runRef.runId;
    const run = findRecord(state, 'venture-delivery-run', runId);
    if (run) await import('./delivery-signoff.ts').then(module => module.requestSignoffForRun(deps, ctx, run)).catch(() => null);
  }
  return { explanation: explanationView(record) };
}
