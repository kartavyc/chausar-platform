// Chausar delivery harness: venture.delegate.get, what the owner's own Claude Code or Codex left on one heavy-work run.
// The record is untrusted: files and a log another AI wrote, with the calculator's checks on the figures it listed.
import { check, type Context } from '../../../contracts.ts';
import { exactPayload, findRecord, identifier } from '../../records.ts';
import type { DelegateRunRecord, VentureDeps } from '../../contracts.ts';
import { readAs } from '../shared.ts';

export async function delegateGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DelegateRunRecord> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Heavy-work run');
  const { state, venture } = readAs(deps, ctx, 'read');
  const record = findRecord(state, 'venture-delegate-run', id);
  check(record && record.ventureId === venture.id, 'DELEGATE_RUN_NOT_FOUND', 'That heavy-work run was not found.');
  return record;
}
