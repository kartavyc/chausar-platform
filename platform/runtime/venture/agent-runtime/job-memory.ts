import type { State } from '../../contracts.ts';
import type { OrderRecord, PlaybookRecord, VentureRecord } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { recallNotes } from '../agents/recall.ts';
import { knowledgeForTurn, turnQuery } from '../agents/knowledge-recall.ts';

/** Owner memory is background data. Sources derived from another order never enter this job. */
export function jobMemory(state: State, venture: VentureRecord, order: OrderRecord, playbook: PlaybookRecord, offer: string, guidance: readonly string[]) {
  const scoped: State = { ...state, conversations: state.conversations.filter(record => {
    if (record?.kind !== 'venture-knowledge' || record.ventureId !== venture.id) return true;
    if (record.runId) {
      const run = findRecord(state, 'venture-delivery-run', record.runId);
      if (!run || run.ventureId !== venture.id || run.orderId !== order.id) return false;
    }
    if (record.uploadId) {
      const file = findRecord(state, 'venture-upload', record.uploadId);
      if (!file || file.ventureId !== venture.id || !('orderId' in file.scope) || file.scope.orderId !== order.id) return false;
    }
    return true;
  }) };
  // The tool owns both gathering and writing now. Include the roles of both kinds of step.
  const allWork = { ...playbook, steps: playbook.steps.map(step => step.kind === 'write' ? { ...step, kind: 'work' as const } : step) };
  const notes = recallNotes(scoped, venture, allWork, order);
  const query = [turnQuery('act', playbook.steps, order.request, offer), turnQuery('write', playbook.steps, order.request, offer, guidance)].join('\n');
  return { notes: { background: true as const, items: notes }, knowledge: { background: true as const, items: knowledgeForTurn(scoped, venture, query) } };
}
