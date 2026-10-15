/**
 * Synthetic round 4 Today replies for the fake engine (`createFakeEngine({ today4: true })`), and
 * typed fixtures for the other lanes' methods Today calls, in their real contracts:
 * work-books' `approvals.get` / `approve` / `notNow` (docs/lanes/work-books.md "Work: approvals.*")
 * and hosted-link's `phone.documents.preview` / `discard` (docs/lanes/hosted-link.md, PH-05). A test
 * or preview adds those with `registerFakeMethods('approvals', approvalsTodayFixture())` and
 * `registerFakeMethods('phone', phoneDocumentsFixture())`. Codes, ids, digits and ISO dates only;
 * every name is invented. Only `bridge/fake.ts` and tests import this file.
 */
import type { FakeContext, FakeHandler } from '../fake.ts';
import type { CashWeekReply, CloseStatusReply, TodayReviewReply } from '../todayx-contract.ts';

export const DEMO_REMINDER_IDS = ['writeback:wb_demo_reminder_1', 'writeback:wb_demo_reminder_2', 'writeback:wb_demo_reminder_3'] as const;
export const DEMO_MONEY_ID = 'writeback:wb_demo_payment';
export const DEMO_DOCUMENT_ID = 'phonedoc_demo_1';
const CUSTOMERS = ['Kiran Retail Demo', 'Meera Stores Demo', 'Asha Traders Demo'];

export function todayReviewFixture(role: FakeContext['role'], date: string, done: ReadonlySet<string>, documents: boolean): TodayReviewReply {
  const approver = role === 'owner' || role === 'cofounder';
  const reminders = DEMO_REMINDER_IDS.filter(id => !done.has(id));
  const money = done.has(DEMO_MONEY_ID) ? [] : [DEMO_MONEY_ID];
  const docs = documents ? [{ documentId: DEMO_DOCUMENT_ID, channel: 'whatsapp' as const, mediaType: 'text/csv', receivedAt: `${date}T04:30:00.000Z` }] : [];
  if (!approver) return { approvals: 'ready', items: [], groups: [], documents: 'ready', phoneDocuments: [], count: '0', waiting: String(reminders.length + money.length + docs.length) };
  const groups = reminders.length >= 2 ? [{ id: `group:${reminders[0]}`, ids: [...reminders], source: 'writeback' as const, kind: 'message' as const, count: String(reminders.length), since: `${date}T03:10:00.000Z` }] : [];
  const single = reminders.length === 1 ? [reminders[0]!] : [];
  const items = [
    ...single.map(id => ({ id, source: 'writeback' as const, kind: 'message' as const, tier: 'tier-1' as const, title: 'Send a payment reminder', touches: 'Mail: Kiran Retail Demo', amountPaise: null, since: `${date}T03:10:00.000Z`, core: false })),
    ...money.map(id => ({ id, source: 'writeback' as const, kind: 'money' as const, tier: 'tier-2' as const, title: 'Pay a supplier bill', touches: 'Bank: Meera Stores Demo', amountPaise: '1840000', since: `${date}T02:00:00.000Z`, core: false })),
  ];
  return { approvals: 'ready', items, groups, documents: 'ready', phoneDocuments: docs, count: String(reminders.length + money.length + docs.length), waiting: '0' };
}

export function closeStatusFixture(date: string): CloseStatusReply {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const prior = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  return { month: prior, parts: { bank: 'in-progress', gstr2b: 'needs-you', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' } };
}

const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
export function cashWeekFixture(date: string, told: ReadonlyMap<string, string>): CashWeekReply {
  return { day: date, label: 'told-by-owner', days: Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map(day => {
    const paise = told.get(day) ?? null;
    return { day, paise, entryId: paise === null ? null : `cash_${day.replaceAll('-', '')}_demo` };
  }) };
}

/* ------------------------------------------------------------------ work-books' approvals, for one item at a time */

const DIGEST = (id: string) => id.replace(/[^a-z0-9]/g, '').padEnd(64, '0').slice(0, 64);
function detail(id: string, date: string, state: 'prepared' | 'approved') {
  const index = DEMO_REMINDER_IDS.indexOf(id as (typeof DEMO_REMINDER_IDS)[number]);
  const money = id === DEMO_MONEY_ID;
  const customer = CUSTOMERS[Math.max(0, index)]!;
  return {
    id, source: 'writeback', kind: money ? 'money' : 'message', tier: money ? 'tier-2' : 'tier-1',
    title: money ? 'Pay a supplier bill' : 'Send a payment reminder', touches: `Mail: ${customer}`, amount: money ? { minor: '1840000' } : null,
    preparedBy: { kind: 'person', name: 'Asha Demo' }, createdAt: `${date}T03:10:00.000Z`, expiresAt: `${date}T23:00:00.000Z`, state, practice: false,
    digest: DIGEST(id), revision: 1, reason: money ? 'always-waits:money' : 'always-waits:message',
    change: { asWritten: `Dear ${customer}, invoice INV-DEMO-${index + 1} is due. Please pay when you can.` },
    steps: [
      { name: 'prepared', state: 'done', at: `${date}T03:10:00.000Z` },
      { name: 'approved', state: state === 'approved' ? 'done' : 'waiting-for-you', at: null },
      { name: 'done', state: 'not-reached', at: null }, { name: 'read-back', state: 'not-reached', at: null }, { name: 'recorded', state: 'not-reached', at: null },
    ],
    can: state === 'prepared' ? ['approve', 'notNow', 'drop'] : [], readOnly: false, prepareOnly: false, needsSecondAsk: money,
    ...(money ? { secondAsk: { by: 'passphrase' } } : {}),
  };
}

/** `approvals.get` / `approve` / `notNow` over the demo reminders and the money item. The store remembers what was decided. */
export function approvalsTodayFixture(): Readonly<Record<string, FakeHandler>> {
  const decided = (context: FakeContext) => {
    const held = context.store.get('today4.decided');
    if (held instanceof Set) return held as Set<string>;
    const fresh = new Set<string>(); context.store.set('today4.decided', fresh); return fresh;
  };
  const known = (id: unknown): id is string => typeof id === 'string' && ((DEMO_REMINDER_IDS as readonly string[]).includes(id) || id === DEMO_MONEY_ID);
  return {
    get: (payload, context) => {
      if (!known(payload['id'])) throw context.refuse('NOT_FOUND', 'No approval has that id.');
      return detail(payload['id'], context.date, decided(context).has(payload['id']) ? 'approved' : 'prepared');
    },
    approve: (payload, context) => {
      const id = payload['id'];
      if (context.role !== 'owner' && context.role !== 'cofounder') throw context.refuse('FORBIDDEN', 'An owner must approve this change.');
      if (!known(id)) throw context.refuse('NOT_FOUND', 'No approval has that id.');
      if (payload['digest'] !== DIGEST(id)) throw context.refuse('PREVIEW_CHANGED', 'The prepared request changed.');
      if (id === DEMO_MONEY_ID && payload['secondAsk'] !== true) throw context.refuse('SECOND_ASK_REQUIRED', 'Money asks again.');
      decided(context).add(id);
      return detail(id, context.date, 'approved');
    },
    notNow: (payload, context) => {
      if (!known(payload['id'])) throw context.refuse('NOT_FOUND', 'No approval has that id.');
      decided(context).add(payload['id']);
      return { id: payload['id'], snoozedUntil: `${context.date}T23:59:00.000Z` };
    },
  };
}

/* ------------------------------------------------------------------ hosted-link's phone documents */

/** A CSV document from the phone: its preview through the normal import preview, and discard. `format` picks a PDF that cannot be previewed. */
export function phoneDocumentsFixture(options: { readonly mediaType?: 'text/csv' | 'application/pdf' } = {}): Readonly<Record<string, FakeHandler>> {
  const mediaType = options.mediaType ?? 'text/csv';
  return {
    'documents.preview': (payload, context) => {
      if (payload['documentId'] !== DEMO_DOCUMENT_ID) throw context.refuse('DOCUMENT_NOT_FOUND', 'That document is no longer waiting for review.');
      if (mediaType !== 'text/csv') throw context.refuse('DOCUMENT_PREVIEW_UNAVAILABLE', 'Only a CSV file can be previewed for import today.');
      return {
        documentId: DEMO_DOCUMENT_ID, name: 'Document from WhatsApp', mediaType, outside: true, sourceTainted: true, imported: false, experimental: true, label: 'Outside data from your phone.',
        preview: { accepted: true, errors: [], unmappedFields: [], facts: [], totalsMinor: '1250000', coverage: { sourceRows: 3, importedRows: 3, rejectedRows: 0, expectedRows: null, reconciled: false }, format: 'csv', qualification: 'experimental' },
        confirm: { method: 'sources.import', input: { sourceId: 'phone-document-demo', format: 'csv', content: 'date,amount\n2026-09-30,1250\n' } },
      };
    },
    'documents.discard': (payload, context) => {
      if (payload['documentId'] !== DEMO_DOCUMENT_ID) throw context.refuse('DOCUMENT_NOT_FOUND', 'That document is no longer waiting for review.');
      context.store.set('today4.document', 'discarded');
      return { documentId: DEMO_DOCUMENT_ID, discarded: true };
    },
  };
}
