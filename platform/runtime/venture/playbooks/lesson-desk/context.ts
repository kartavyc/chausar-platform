// Chausar playbook: what an AI job on a lesson order may read (wave 6, package 6E2), called from
// agent-runtime/desk-context.ts. Only the learners linked to this order, each a child only with their parent's current
// consent (core.ts lessonAiLearners refuses with the D21 child-data hard stop). The client AI permission for the order's
// client is checked separately at dispatch. Written for Chausar; nothing here is learned from an outside source.
import type { State } from '../../../contracts.ts';
import type { DeliveryRunRecord, OrderRecord } from '../../contracts.ts';
import { digest, listRecords } from '../../records.ts';
import { lessonAiLearners } from './core.ts';
import { lessonWorld } from './desk.ts';

export function lessonDeskContext(state: State, run: Pick<DeliveryRunRecord, 'ventureId'> & { at?: string }, order: OrderRecord) {
  const venture = listRecords(state, 'venture-record').find(row => row.id === run.ventureId)!;
  const world = lessonWorld(state, venture, run.at ?? new Date().toISOString());
  const learners = listRecords(state, 'venture-lesson-batch', run.ventureId).flatMap(row => lessonAiLearners(row.batch, order.id, world));
  return { binding: digest({ orderId: order.id, learners }), data: { lessonLearners: learners } };
}
