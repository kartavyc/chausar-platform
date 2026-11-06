// Chausar playbook: the lesson desk on Work (wave 6, package 6E2), through venture.desk.list, .get and .act with kind
// 'batch'. The pure transitions are core.ts (shared with the fake engine); this file reads and writes the batch record,
// drafts fee invoices with the existing invoice code (money/invoices.ts draftInvoiceIn, parts from 6D1) and hands an
// approved parent message to the owner through the action journal (owner.handoff, bound to the message digest).
// Chausar sends nothing. Written for Chausar; nothing here is learned from an outside source.
import { formatMoney } from '../../../owner-format.ts';
import { check, type Context, type State } from '../../../contracts.ts';
import type { DeskHandlers, DeskKindTypes } from '../desk-types.ts';
import type { LessonBatchRecord, VentureDeps, VentureRecord } from '../../contracts.ts';
import { listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import { journalled } from '../../journal/journal.ts';
import { draftInvoiceIn } from '../../money/invoices.ts';
import { partAskOf } from '../../money/invoice-parts.ts';
import { consentState, todayOf } from '../kit/voice-consent.ts';
import { ownerHandoff } from '../kit/owner-message.ts';
import {
  LESSON_PLAYBOOK, batchDigest, batchRow, batchView, exact, idOf, lessonAct, lessonRequest, markHandedOff, messageOf, newBatch,
  type LessonWorld,
} from './core.ts';

/** One record kind: a batch, with its learners, classes, work and parent messages inside it. */
export type LessonDeskDeskTypes = { batch: DeskKindTypes };
const playbook = LESSON_PLAYBOOK;
const KIND = 'venture-lesson-batch' as const;
const CHANGED = 'Read the batch again before you change it.';

/** The business's records the core reads: clients, orders, person consents (with today's state) and invoices. */
export function lessonWorld(state: State, venture: VentureRecord, now: Date | string): LessonWorld {
  const today = todayOf(venture, now);
  return {
    client(id) { const client = listRecords(state, 'venture-client', venture.id).find(row => row.id === id && !row.self); return client ? { id: client.id, name: client.name, email: client.email } : null; },
    order(id) { const order = listRecords(state, 'venture-order', venture.id).find(row => row.id === id); return order ? { id: order.id, clientId: order.clientId, status: order.status } : null; },
    consent(id) { const record = listRecords(state, 'venture-voice-consent', venture.id).find(row => row.id === id); return record ? { id: record.id, speaker: record.speaker, state: consentState(state, record, today) } : null; },
    fees(orderId) {
      return listRecords(state, 'venture-invoice', venture.id).filter(row => row.orderId === orderId && row.status !== 'void').map(row => ({
        invoiceId: row.id, number: row.number, status: row.status, total: formatMoney(row.totalMinor, row.currency), balance: formatMoney(row.balanceMinor, row.currency), receiptId: row.priceReceiptId,
      }));
    },
  };
}

function batchOf(records: readonly LessonBatchRecord[], id: string): LessonBatchRecord {
  const record = records.find(row => row.id === id);
  check(record, 'LESSON_BATCH_NOT_FOUND', 'That batch was not found.');
  return record;
}

/** Hands one approved message to the owner: the journal records the approval of these exact words; nothing is sent. */
async function handoff(deps: VentureDeps, ctx: Context, id: string, p: Record<string, unknown>) {
  const { state, venture } = readVenture(deps, ctx);
  const record = batchOf(listRecords(state, KIND, venture.id), id);
  check(p.digest === batchDigest(record.batch), 'APPROVAL_CHANGED', CHANGED);
  const message = messageOf(record.batch, p.payload);
  const link = ownerHandoff(message);
  if (message.handedOffAt) return { playbook, kind: 'batch', id, result: { messageId: message.id, handoff: link, replayed: true }, line: link.line };
  const flat = message.text.replace(/\s+/g, ' ').trim(), shown = flat.length <= 220;
  await journalled(deps, ctx, {
    action: 'owner.handoff', operation: 'lesson-message', subject: `lesson:${id}:${message.id}`, target: message.channel === 'email' ? 'Your mail app' : 'WhatsApp',
    actionDigest: message.digest, descriptionComplete: shown,
    line: `Hand this exact message to you to send yourself: ${shown ? flat : `${flat.slice(0, 220)}...`}`,
  }, async handle => {
    await ventureAction(deps, ctx, 'approve', 'lesson.handoff', tx => {
      const current = batchOf(tx.list(KIND), id);
      check(batchDigest(current.batch) === p.digest, 'APPROVAL_CHANGED', CHANGED);
      tx.replace<LessonBatchRecord>({ ...current, batch: markHandedOff(current.batch, message.id, tx.now, handle.entry.id) });
      handle.settleIn(tx, link.line);
      tx.emit('desk.changed', { playbook });
    });
    return { outcome: 'applied' as const, line: link.line, value: link };
  });
  return { playbook, kind: 'batch', id, result: { messageId: message.id, handoff: link }, line: link.line };
}

export const LESSON_DESK_DESK: DeskHandlers = {
  batch: {
    async list(deps, ctx, raw) {
      lessonRequest(raw, 'list');
      const { state, venture } = readVenture(deps, ctx);
      return { playbook, kind: 'batch', rows: listRecords(state, KIND, venture.id).map(row => batchRow(row.id, row.batch)), line: 'Your batches. Counts are made by Chausar.' } as never;
    },
    async get(deps, ctx, raw) {
      const p = lessonRequest(raw, 'get');
      const { state, venture } = readVenture(deps, ctx);
      const record = batchOf(listRecords(state, KIND, venture.id), idOf(p.id, 'Batch'));
      return { playbook, kind: 'batch', item: batchView(record.id, record.batch, lessonWorld(state, venture, deps.clock())), digest: batchDigest(record.batch) } as never;
    },
    async act(deps, ctx, raw) {
      requireAppChannel(ctx, 'venture.desk.act');
      const p = lessonRequest(raw, 'act');
      const action = typeof p.action === 'string' ? p.action : '';
      if (action === 'create') {
        check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Make a new batch with the id new.');
        const batch = newBatch(p.payload);
        return ventureAction(deps, ctx, 'approve', 'lesson.desk', tx => {
          const record = tx.put<LessonBatchRecord>({ ...tx.base(KIND), batch });
          tx.emit('desk.changed', { playbook });
          return { playbook, kind: 'batch', id: record.id, result: { batchId: record.id }, line: 'Batch made.' };
        }) as never;
      }
      const id = idOf(p.id, 'Batch');
      if (action === 'handoff') return handoff(deps, ctx, id, p) as never;
      return ventureAction(deps, ctx, 'approve', 'lesson.desk', tx => {
        const record = batchOf(tx.list(KIND), id);
        check(p.digest === batchDigest(record.batch), 'APPROVAL_CHANGED', CHANGED);
        const world = lessonWorld(tx.state, tx.venture!, tx.now);
        if (action === 'fee') {
          const b = exact(p.payload, ['learnerId', 'part'], ['learnerId']);
          const learner = record.batch.learners.find(item => item.id === b.learnerId);
          check(learner, 'LESSON_LEARNER_NOT_FOUND', 'Choose a learner in this batch.');
          check(learner.orderId, 'LESSON_ORDER_REQUIRED', "Link this learner to their fee order first.");
          const order = world.order(learner.orderId);
          check(order && order.status !== 'cancelled' && order.clientId === learner.guardianClientId, 'LESSON_ORDER_MISMATCH', "Choose an open order of this learner's parent or guardian.");
          const priced = tx.find('venture-order', order.id)!;
          const currency = tx.find('venture-price-receipt', priced.priceReceiptId)?.currency ?? 'INR';
          const invoice = draftInvoiceIn(tx, { orderId: order.id, dueInDays: null, issueDate: null, part: b.part === undefined ? null : partAskOf(b.part, currency), reminderDays: null });
          tx.emit('desk.changed', { playbook });
          return { playbook, kind: 'batch', id, result: { invoiceId: invoice.id }, line: 'Fee invoice drafted. Check and issue it in Money.' };
        }
        const outcome = lessonAct(record.batch, action, p.payload, world);
        tx.replace<LessonBatchRecord>({ ...record, batch: outcome.batch });
        tx.emit('desk.changed', { playbook });
        return { playbook, kind: 'batch', id, result: outcome.result, line: outcome.line };
      }) as never;
    },
  },
};
