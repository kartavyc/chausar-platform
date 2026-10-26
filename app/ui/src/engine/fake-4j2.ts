/**
 * The fake engine's answers for two wave 4 approval methods (4J2): venture.queue.setPreview, the set as the engine works
 * it out before the owner approves it (platform/runtime/venture/views/queue-actions.ts), and venture.delivery.copy, a
 * new owner draft made from one that went out (platform/runtime/venture/delivery/copy.ts). Same codes, shapes and
 * words as the engine. Like the engine, the fake keeps a view mark for each row venture.queue.view opens with
 * opened: true (every fake call is the app's own; 4J19: a preview fetch leaves none), and venture.queue.set answers VIEW_FIRST for an item that must be read first and was not
 * opened in that exact version. Posts, draft reviews and spot checks cost nothing, so a set's total is always USD 0.0000.
 */

import { EngineError, type DeliveryLite, type QueueDecision, type QueueRow, type QueueSetPreview } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4J2_METHODS: readonly string[] = ['venture.queue.setPreview', 'venture.queue.set', 'venture.delivery.copy'];

/** The engine's words, word for word. */
const WORDS = {
  pick: 'Pick each item you approve. There is no approve all.',
  stale: 'One of these changed since you picked them. Nothing ran. Look at the set again.',
  kind: 'Only posts and drafts can be approved together. Money, prices, invoices and sign-offs need their own approval.',
  partPost: 'Part of what this post sends is not shown, so approve it on its own.',
  paid: 'This one starts paid work, so it needs its own approval.',
  notSent: 'Only a draft that went out can be copied. This one still waits for your review.',
  practice: 'Practice drafts are not for clients. Move to approve each to use drafts.',
  viewFirst: 'Open it and read it first.',
  secondAsk: 'One of these asks twice. Confirm the set again to approve it.',
} as const;
const ZERO = 'USD 0.0000';

const subjectOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf(':')));
const versionOf = (id: string) => id.slice(id.lastIndexOf(':') + 1);

/** Why a row can't go in a set, or null: the engine's setRefusal. */
function refusal(row: QueueRow): { reason: string; line: string } | null {
  const subject = subjectOf(row.id);
  if ((row.kind !== 'connector' && row.kind !== 'draft') || !row.actions.some((action) => action.id === 'approve')) return { reason: 'SET_KIND_REFUSED', line: WORDS.kind };
  if (row.kind === 'connector') {
    if (!subject.startsWith('post:')) return { reason: 'SET_KIND_REFUSED', line: WORDS.kind };
    return row.descriptionComplete === true ? null : { reason: 'SET_KIND_REFUSED', line: WORDS.partPost };
  }
  if (subject.startsWith('spot:')) return null;
  return subject.startsWith('run:') && versionOf(row.id).startsWith('review') ? null : { reason: 'SET_KIND_REFUSED', line: WORDS.paid };
}

/** Why a fake row can't go in a set: fixture rows without an engine id read a draft opened as a draft as a review. */
function refusalOf(row: QueueRow): { reason: string; line: string } | null {
  if (row.id.includes(':') || row.kind !== 'draft') return refusal(row);
  if (!row.actions.some((action) => action.id === 'approve')) return { reason: 'SET_KIND_REFUSED', line: WORDS.kind };
  return row.viewRef?.kind === 'draft' ? null : { reason: 'SET_KIND_REFUSED', line: WORDS.paid };
}

type Worked = { picked: QueueRow[]; refusals: QueueSetPreview['refusals']; secondAsk: boolean; digest: string };

/**
 * The fake's sets, as the engine's (views/queue-actions.ts and views/view-marks.ts): view marks by row id and digest,
 * the set worked out the same way for the preview and the approval, and each item then decided as on Today.
 */
export class FakeSets {
  private readonly host: W4DeskHost;
  private readonly marks = new Map<string, Set<string>>();

  constructor(host: W4DeskHost) {
    this.host = host;
  }

  /** venture.queue.view opened these rows (by row id, or by what they open): each keeps a mark for its present version. */
  markViewed(opened: { id: unknown; kind?: unknown }): void {
    for (const row of this.host.rows()) {
      const match = row.id === opened.id || (row.viewRef?.id === opened.id && (opened.kind === undefined || row.viewRef?.kind === opened.kind));
      if (!match) continue;
      const digests = this.marks.get(row.id) ?? new Set<string>();
      digests.add(row.digest);
      this.marks.set(row.id, digests);
    }
  }

  private viewed(row: QueueRow): boolean {
    return this.marks.get(row.id)?.has(row.digest) ?? false;
  }

  private ids(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || !value.every((id) => typeof id === 'string' && id.length > 0 && id !== 'all')) throw new EngineError('SET_NEEDS_PICK', WORDS.pick);
    if (new Set(value).size !== value.length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Pick each item once.');
    return value as string[];
  }

  private work(ids: readonly string[]): Worked {
    const rows = this.host.rows();
    const refusals: QueueSetPreview['refusals'] = [];
    const picked: QueueRow[] = [];
    for (const id of ids) {
      const row = rows.find((item) => item.id === id && item.kind !== 'locked');
      if (!row) { refusals.push({ rowId: id, reason: 'APPROVAL_STALE', line: WORDS.stale }); continue; }
      picked.push(row);
      const why = refusalOf(row);
      if (why) { refusals.push({ rowId: id, ...why }); continue; }
      const approve = row.actions.find((action) => action.id === 'approve');
      if (approve?.requiresView && !this.viewed(row)) refusals.push({ rowId: id, reason: 'VIEW_FIRST', line: WORDS.viewFirst });
    }
    const secondAsk = picked.some((row) => row.actions.some((action) => action.id === 'approve' && action.secondAsk));
    return { picked, refusals, secondAsk, digest: this.host.digest({ rows: picked.map((row) => [row.id, row.digest]), totalMicros: '0' }) };
  }

  /** venture.queue.setPreview { rowIds }. */
  preview(p: Record<string, unknown>): QueueSetPreview {
    const worked = this.work(this.ids(p.rowIds));
    return {
      digest: worked.digest, items: worked.picked.map((row) => ({ rowId: row.id, title: row.title, kind: row.kind, cost: ZERO })),
      total: { display: ZERO, receiptId: `fake-set-${worked.digest.slice(0, 12)}` }, secondAsk: worked.secondAsk, refusals: worked.refusals,
    };
  }

  /** venture.queue.set { rowIds, digest, secondAsk? }. */
  set(p: Record<string, unknown>): { decisions: QueueDecision[]; line: string; receiptId?: string } {
    const ids = this.ids(p.rowIds);
    if (typeof p.digest !== 'string' || !p.digest) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the digest of the set you saw.');
    const worked = this.work(ids);
    const [first] = worked.refusals;
    if (first) throw new EngineError(first.reason, first.line);
    if (worked.digest !== p.digest) throw new EngineError('APPROVAL_STALE', WORDS.stale);
    if (worked.secondAsk && p.secondAsk !== true) throw new EngineError('SET_NEEDS_SECOND_ASK', WORDS.secondAsk);
    const decisions: QueueDecision[] = [];
    let done = 0;
    for (const row of worked.picked) {
      const decision = this.host.ask('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true }) as QueueDecision;
      decisions.push(decision);
      if (decision.outcome !== 'done') break;
      done += 1;
    }
    const stopped = decisions.find((item) => item.outcome !== 'done');
    const line = stopped ? `Approved ${done} of ${worked.picked.length}. Stopped at the next one: ${stopped.line}` : `Approved ${done} of ${worked.picked.length}. Each one has its own record.`;
    return { decisions, line, ...(done ? { receiptId: `fake-set-${worked.digest.slice(0, 12)}` } : {}) };
  }
}

/** venture.delivery.copy { runId }: kept beside the fake's other drafts when the host can keep one. */
export function fakeDeliveryCopy(host: W4DeskHost, p: Record<string, unknown>): DeliveryLite {
  const source = (host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((run) => run.id === p.runId);
  if (!source) throw new EngineError('DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  if (source.status !== 'accepted' && source.status !== 'edited') throw new EngineError('COPY_NOT_SENT', WORDS.notSent);
  if (source.practice) throw new EngineError('PRACTICE_DRAFT', WORDS.practice);
  const copy: DeliveryLite = {
    id: `d-copy-${host.digest({ from: source.id, at: host.now() }).slice(0, 10)}`, at: host.now(), orderId: source.orderId, status: 'ready-for-review',
    practice: false, deliverable: source.deliverable, verdict: null, awaitingYou: true, servedBy: 'owner', practiceNow: false, checks: [],
    canAccept: true, acceptBlocked: null, copiedFrom: source.id,
  };
  return host.keepDelivery ? host.keepDelivery(copy) : copy;
}
