import { check, type State } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { digest, findRecord, listRecords, requireVenture } from '../records.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';

/** Only the AI read path uses this scope. Owner-only summaries keep their complete local view. */
export function chiefClientContext(deps: VentureDeps, ventureId: string) {
  const initial = deps.store.read();
  const grants = new Map(listRecords(initial, 'venture-client', ventureId).flatMap(client => {
    const grant = client.aiConsent;
    return grant && !grant.withdrawnAt ? [[client.id, { consentId: grant.id, consentRevision: grant.revision }] as const] : [];
  }));
  const used = new Set<string>(), sources = new Map<string, string>();
  function remember(id: string): void {
    const row = initial.conversations.find(row => row.id === id && row.ventureId === ventureId);
    if (row && !sources.has(id)) sources.set(id, digest(row));
  }
  function client(id: string): boolean {
    const expected = grants.get(id);
    if (!expected) return false;
    requireClientAiConsent(deps.store.read(), ventureId, id, expected);
    used.add(id); remember(id); return true;
  }
  function order(id: string): boolean {
    const row = findRecord(initial, 'venture-order', id);
    if (!row || row.ventureId !== ventureId || row.status === 'cancelled' || !client(row.clientId)) return false;
    remember(id); return true;
  }
  function record(id: string, followJournal = true): boolean {
    const row = initial.conversations.find(row => row.id === id && row.ventureId === ventureId);
    if (!row) return false;
    if (row.kind === 'venture-client') return client(id);
    if (row.kind === 'venture-order') return order(id);
    if (row.kind === 'venture-delivery-run' || row.kind === 'venture-invoice') {
      if (!order(row.orderId)) return false;
      remember(id); return true;
    }
    if (followJournal && row.kind === 'venture-journal-entry' && subject(row.subject, false)) {
      remember(id); return true;
    }
    return false;
  }
  function subject(value: string, followJournal = true): boolean {
    // These are engine-owned queue subject formats, never a client name or free-text match.
    const prefixed = /^(?:run|invoice|order|client):([^:]+)$/.exec(value);
    return record(prefixed ? prefixed[1]! : value, followJournal);
  }
  function assert(current: State = deps.store.read()): void {
    check(requireVenture(current).id === ventureId, 'JOB_SCOPE_CHANGED', 'The business changed during this answer.');
    for (const id of used) requireClientAiConsent(current, ventureId, id, grants.get(id)!);
    for (const [id, expected] of sources) {
      const row = current.conversations.find(row => row.id === id && row.ventureId === ventureId);
      check(row && digest(row) === expected, 'JOB_SOURCE_CHANGED', 'The client records changed during this answer. Ask again.');
    }
  }
  return { client, order, record, subject, assert };
}
export type ChiefClientContext = ReturnType<typeof chiefClientContext>;
