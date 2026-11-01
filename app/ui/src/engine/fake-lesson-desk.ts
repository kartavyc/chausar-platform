// The fake engine's lesson desk (wave 6, package 6E2): the engine's own core (playbooks/lesson-desk/core.ts) over
// in-memory batches, so every code, word, id and digest matches the engine. Fees go through the fake money's own
// invoice prepare; a parent message is handed to the owner after the exact digest is approved, and nothing is sent.
import { check } from '../../../../platform/runtime/portable';
import { ownerHandoff } from '../../../../platform/runtime/venture/playbooks/kit/owner-message';
import {
  LESSON_PLAYBOOK, batchDigest, batchRow, batchView, exact, idOf, lessonAct, lessonRequest, markHandedOff, messageOf, newBatch, withoutLearners,
  type LessonFee, type LessonWorld,
} from '../../../../platform/runtime/venture/playbooks/lesson-desk/core';
import type { LessonBatchBody } from '../../../../platform/runtime/venture/playbooks/lesson-desk/records';
import { EngineError, type ClientLite, type InvoiceViewLite, type OrderLite, type VoiceConsentsView } from './types';
import type { FakeDeskKind, FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';

const CHANGED = 'Read the batch again before you change it.';

/** The fake's answers for the records the core reads: clients, orders, voice consents and invoices. */
export function fakeLessonWorld(host: W4DeskHost): LessonWorld {
  const clients = () => (host.ask('venture.client.list', {}) as ClientLite[]).filter(client => !client.self);
  const orders = () => host.ask('venture.order.list', {}) as OrderLite[];
  return {
    client(id) { const client = clients().find(row => row.id === id); return client ? { id: client.id, name: client.name, email: client.email } : null; },
    order(id) { const order = orders().find(row => row.id === id); return order ? { id: order.id, clientId: order.clientId, status: order.status } : null; },
    consent(id) { const row = (host.ask('venture.voiceConsent.list', {}) as VoiceConsentsView).consents.find(item => item.id === id); return row ? { id: row.id, speaker: row.speaker, state: row.state } : null; },
    fees(orderId) {
      const rows = (host.ask('venture.invoice.list', {}) as { id: string; orderId: string; status: string; at: string }[]).filter(row => row.orderId === orderId && row.status !== 'void').sort((a, b) => a.at.localeCompare(b.at));
      return rows.map((row): LessonFee => {
        const view = host.ask('venture.invoice.get', { invoiceId: row.id }) as InvoiceViewLite;
        const figure = (key: string) => view.figures.find(item => item.key === key)?.display ?? '';
        return { invoiceId: view.invoice.id, number: view.invoice.number, status: view.invoice.status, total: figure('total'), balance: figure('balance'), receiptId: view.invoice.priceReceiptId };
      });
    },
  };
}

export function fakeLessonDeskDesk(host: W4DeskHost): FakePlaybookDesk {
  const spaces = new Map<string, Map<string, LessonBatchBody>>();
  let seq = 0, journals = 0;
  const space = () => { let held = spaces.get(host.current()); if (!held) { held = new Map(); spaces.set(host.current(), held); } return held; };
  const find = (id: string) => { const batch = space().get(id); check(batch, 'LESSON_BATCH_NOT_FOUND', 'That batch was not found.'); return batch; };
  const emit = () => host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() } as never);
  const run = <T>(work: () => T): T => { try { return work(); } catch (error) { const e = error as Error & { code?: string }; throw e instanceof EngineError ? e : new EngineError(e.code ?? 'INVALID_VENTURE_REQUEST', e.message); } };
  const batch: FakeDeskKind = {
    list: raw => run(() => { lessonRequest(raw, 'list'); return { playbook: LESSON_PLAYBOOK, kind: 'batch', rows: [...space()].map(([id, body]) => batchRow(id, body)), line: 'Your batches. Counts are made by Chausar.' }; }),
    get: raw => run(() => {
      const p = lessonRequest(raw, 'get'), id = idOf(p.id, 'Batch'), body = find(id);
      return { playbook: LESSON_PLAYBOOK, kind: 'batch', item: structuredClone(batchView(id, body, fakeLessonWorld(host))), digest: batchDigest(body) };
    }),
    act: raw => run(() => {
      const p = lessonRequest(raw, 'act');
      const action = typeof p.action === 'string' ? p.action : '';
      if (action === 'create') {
        check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Make a new batch with the id new.');
        const body = newBatch(p.payload), id = `lessonbatch_fake${++seq}`;
        space().set(id, body); emit();
        return { playbook: LESSON_PLAYBOOK, kind: 'batch', id, result: { batchId: id }, line: 'Batch made.' };
      }
      const id = idOf(p.id, 'Batch'), body = find(id);
      check(p.digest === batchDigest(body), 'APPROVAL_CHANGED', CHANGED);
      const world = fakeLessonWorld(host);
      if (action === 'handoff') {
        const message = messageOf(body, p.payload), link = ownerHandoff(message);
        if (message.handedOffAt) return { playbook: LESSON_PLAYBOOK, kind: 'batch', id, result: { messageId: message.id, handoff: link, replayed: true }, line: link.line };
        space().set(id, markHandedOff(body, message.id, host.now(), `journal_fake${++journals}`)); emit();
        return { playbook: LESSON_PLAYBOOK, kind: 'batch', id, result: { messageId: message.id, handoff: link }, line: link.line };
      }
      if (action === 'fee') {
        const b = exact(p.payload, ['learnerId', 'part'], ['learnerId']);
        const learner = body.learners.find(item => item.id === b.learnerId);
        check(learner, 'LESSON_LEARNER_NOT_FOUND', 'Choose a learner in this batch.');
        check(learner.orderId, 'LESSON_ORDER_REQUIRED', 'Link this learner to their fee order first.');
        const order = world.order(learner.orderId);
        check(order && order.status !== 'cancelled' && order.clientId === learner.guardianClientId, 'LESSON_ORDER_MISMATCH', "Choose an open order of this learner's parent or guardian.");
        const view = host.ask('venture.invoice.prepare', { orderId: order.id, ...(b.part === undefined ? {} : { part: b.part }) }) as InvoiceViewLite;
        emit();
        return { playbook: LESSON_PLAYBOOK, kind: 'batch', id, result: { invoiceId: view.invoice.id }, line: 'Fee invoice drafted. Check and issue it in Money.' };
      }
      const outcome = lessonAct(body, action, p.payload, world);
      space().set(id, outcome.batch); emit();
      return { playbook: LESSON_PLAYBOOK, kind: 'batch', id, result: structuredClone(outcome.result), line: outcome.line };
    }),
  };
  return {
    playbook: LESSON_PLAYBOOK,
    kinds: { batch },
    forgetPeople(people) {
      const clientIds = new Set(people.flatMap(person => person.clientId ? [person.clientId] : []));
      const handles = people.flatMap(person => [...person.names, ...person.emails, ...person.phones]).filter(handle => handle.length >= 3).map(handle => handle.toLowerCase());
      let changed = false;
      for (const [id, body] of space()) {
        const named = (value: unknown) => { const text = (JSON.stringify(value) ?? '').toLowerCase(); return handles.some(handle => text.includes(handle)); };
        const ids = new Set(body.learners.filter(learner => clientIds.has(learner.guardianClientId) || named(learner)).map(learner => learner.id));
        for (const message of body.messages) if (named(message.to) || named(message.text)) ids.add(message.learnerId);
        if (ids.size) { space().set(id, withoutLearners(body, ids)); changed = true; }
      }
      if (changed) emit();
    },
  };
}
