// Chausar delivery harness: venture.work.get, one work receipt with its inputs, steps and figures.
// Ink v2 wave 4 (4J14, Q6): the receipt leads with its coverage where code can count it (bank lines matched, rows used).
import { check, type Context } from '../../../contracts.ts';
import { exactPayload, findRecord, identifier } from '../../records.ts';
import type { CoverageView, VentureDeps, WorkReceiptRecord } from '../../contracts.ts';
import { readAs } from '../shared.ts';
import { workReceiptCoverage } from '../coverage.ts';

/** venture.work.get { id } (read): one work receipt, with its coverage where code can count it, else without. */
export async function workGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WorkReceiptRecord & { coverage?: CoverageView }> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Work receipt');
  const { state, venture } = readAs(deps, ctx, 'read');
  const receipt = findRecord(state, 'venture-work-receipt', id);
  check(receipt && receipt.ventureId === venture.id, 'WORK_RECEIPT_NOT_FOUND', 'That work receipt was not found.');
  const coverage = workReceiptCoverage(state, [], receipt);
  return coverage ? { ...receipt, coverage } : receipt;
}
