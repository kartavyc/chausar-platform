// AI-native CA firm: venture.ca.get, venture.ca.setOfRecord, venture.ca.recordSignoff and venture.ca.confirmRates.
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
import { exactPayload, identifier, readVenture, requireAppChannel, singleLine } from '../../records.ts';
import type { CaFirmView, CaPendingRate, CaRequestView, VentureDeps } from '../../contracts.ts';
import { RATE_TABLES, type Citation, type RateTable } from './rates.ts';
import {
  caOfRecord, confirmRateTables, rateKey, recordCaSignoff, sendToCa, sentTo, setCaOfRecord, signoffFor, signoffRequests, unconfirmedRateTables,
  type SignoffRequest,
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
    id: request.id, deliveryId: request.deliveryId ?? '', title: request.title,
    state: decided ? decided.decision : 'sent', at: decided ? decided.at : sent!.at,
  };
}

function caView(state: State, ventureId: string): CaFirmView {
  const ca = caOfRecord(state, ventureId);
  const requests = signoffRequests(state, ventureId)
    .filter(request => typeof request.deliveryId === 'string' && request.deliveryId.length > 0)
    .map(request => requestView(state, ventureId, request))
    .filter((view): view is CaRequestView => view !== null)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    ca: ca ? { name: ca.name, membershipNo: ca.membershipNumber } : null,
    pendingRates: unconfirmedRateTables(state, ventureId).map(pendingRate),
    requests,
  };
}

function current(deps: VentureDeps, ctx: Context): CaFirmView {
  const { state, venture } = readVenture(deps, ctx);
  return caView(state, venture.id);
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
  if (!chosen.length) return caView(state, venture.id);
  const keys = chosen.map(rateKey);
  // Sent to an older CA of record, or not sent: send to the CA confirming now, so the record names who confirmed.
  const unsent = keys.filter(key => sentTo(state, venture.id, key)?.membershipNumber !== ca.membershipNumber);
  if (unsent.length) await sendToCa(deps, ctx, unsent);
  await confirmRateTables(deps, ctx, { keys, membershipNumber: number });
  return current(deps, ctx);
}
