// Chausar delivery harness: venture.work.get, one work receipt with its inputs, steps and figures.
import { check, type Context } from '../../../contracts.ts';
import { exactPayload, findRecord, identifier } from '../../records.ts';
import type { VentureDeps, WorkReceiptRecord } from '../../contracts.ts';
import { readAs } from '../shared.ts';

export async function workGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WorkReceiptRecord> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Work receipt');
  const { state, venture } = readAs(deps, ctx, 'read');
  const receipt = findRecord(state, 'venture-work-receipt', id);
  check(receipt && receipt.ventureId === venture.id, 'WORK_RECEIPT_NOT_FOUND', 'That work receipt was not found.');
  return receipt;
}
