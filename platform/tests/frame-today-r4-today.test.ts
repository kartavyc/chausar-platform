import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context, State } from '../runtime/contracts.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { todayReview } from '../runtime/frame-today/review.ts';
import { worthALookAll } from '../runtime/frame-today/worth.ts';
import { closeMonth, closeStatus } from '../runtime/frame-today/close-status.ts';
import { moduleMethods } from '../runtime/modules/registry.ts';
import {
  isActivityReply, isCashWeekReply, isClosingReply, isCloseStatusReply, isReceiptDetailReply, isTodayReviewReply, isWorthReply,
} from '../../app/ui/src/bridge/todayx-contract.ts';

// Synthetic workspaces and replies only; nothing reaches a network.
const passphrase = 'Round four today synthetic passphrase 2026';
const code = (expected: string) => (error: any) => error?.code === expected;
const period = { from: '2026-09-01', to: '2026-09-30' };
const csv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
order-a,sale,2026-09-03,1250.25,INR,customer-a,invoice-a,order-a,,delivered,Delivered goods,main
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,order-a,2026-09-15,unpaid,Synthetic invoice,main
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,order-a,,settled,Settled receipt,main
`;
const recipe = {
  version: 1, id: 'synthetic-shop-recipe-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Shop', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['settled', 'delivered', 'unpaid'], onUnmapped: 'reject',
};

async function engineWith(t: any, imported = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-today-r4-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Round Four Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('ontology.publish', { pack: 'ecommerce' });
  if (imported) await engine.request('sources.import', { sourceId: 'synthetic-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 3, amountMinor: '455025' } });
  return engine;
}
async function seat(engine: Engine, id: string, role: 'viewer' | 'accountant'): Promise<Context> {
  const member = await engine.request('members.add', { id, name: `Synthetic ${role}`, role, branches: ['*'] });
  return { memberId: member.id, role, epoch: member.epoch, channel: 'desktop' };
}

/* ------------------------------------------------------------------ a stub host over real contract shapes */

const OWNER: Context = { memberId: 'owner-1', role: 'owner', epoch: 1, channel: 'desktop' } as Context;
function stubState(): State {
  return {
    workspace: { id: 'w', name: 'Stub', demo: false }, members: [{ id: 'owner-1', name: 'Owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
      { id: 'acct-1', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] }],
    activity: [], facts: [], receipts: [{ id: 'r1', operation: 'billed' }], modelReceipts: [], routes: [], imports: [], extensions: { 'frame-today': { identity: { fields: {}, gstMode: 'regular', savedAt: '2026-10-01T00:00:00.000Z' } } },
  } as unknown as State;
}
function stubHost(replies: Record<string, unknown>, state = stubState()): ModuleHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, demo: false, directory: '/nonexistent', options: {},
    services: { ontology: { current: () => ({ hash: 'h' }) } },
    store: { read: () => state, update: async (fn: (s: State) => unknown) => fn(state) } as any,
    async call(method: string) {
      calls.push(method);
      if (!Object.hasOwn(replies, method)) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' });
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      return structuredClone(reply);
    },
  };
}
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, source: id.split(':')[0], kind: 'message', tier: 'tier-1', title: `Send a payment reminder ${id}`, touches: 'Mail: customer', amount: null,
  preparedBy: { kind: 'person', name: 'Owner' }, createdAt: '2026-10-01T05:00:00.000Z', expiresAt: '2026-10-02T05:00:00.000Z', state: 'prepared', practice: false, ...extra,
});

test('review join: approvals this seat may act on now, one per item, a summary row counting its items, core rows marked', async () => {
  const list = {
    items: [
      row('writeback:wb_1', { createdAt: '2026-10-01T05:01:00.000Z' }), row('writeback:wb_2', { createdAt: '2026-10-01T05:02:00.000Z' }), row('writeback:wb_3', { createdAt: '2026-10-01T05:03:00.000Z' }),
      row('writeback:wb_money', { kind: 'money', tier: 'tier-2', amount: { minor: '1250000' } }),
      row('action:act_1', { kind: 'record-change' }),
      row('proposal:p_mine', { kind: 'job', tier: 'tier-2', what: { kind: 'start-job', name: 'Daily brief' } }),
      row('proposal:p_other', { kind: 'job', tier: 'tier-2', what: { kind: 'start-job', name: 'Their job' } }),
      row('writeback:wb_sent', { state: 'approved' }),
    ],
    expired: [], snoozed: 0, counts: { tier2: 3, tier1: 5, prepareOnly: 0 },
  };
  const proposals = [{ id: 'p_mine', card: { ownerId: 'owner-1' } }, { id: 'p_other', card: { ownerId: 'someone-else' } }];
  const documents = { experimental: true, label: 'Outside data', keyRegistered: true, documents: [
    { documentId: 'doc_1', name: 'Document from WhatsApp', channel: 'whatsapp', mediaType: 'text/csv', sizeBytes: 120, receivedAt: '2026-10-01T06:00:00.000Z', collectedAt: '2026-10-01T06:01:00.000Z', status: 'awaiting-review', outside: true },
  ] };
  const host = stubHost({ 'approvals.list': list, 'jobsx.proposals': proposals, 'phone.documents.list': documents });
  const owner = await todayReview(OWNER, host);
  assert.ok(isTodayReviewReply(owner), JSON.stringify(owner));
  assert.equal(owner.approvals, 'ready'); assert.equal(owner.documents, 'ready');
  // Three reminders of one sort are one summary row, oldest first inside; money and proposals are never grouped.
  assert.equal(owner.groups.length, 1);
  assert.deepEqual(owner.groups[0]!.ids, ['writeback:wb_1', 'writeback:wb_2', 'writeback:wb_3']);
  assert.equal(owner.groups[0]!.count, '3');
  assert.deepEqual(owner.items.map(item => item.id).sort(), ['action:act_1', 'proposal:p_mine', 'writeback:wb_money']);
  assert.equal(owner.items.find(item => item.id === 'action:act_1')!.core, true, 'today.review already lists core actions');
  assert.equal(owner.items.find(item => item.id === 'writeback:wb_money')!.amountPaise, '1250000');
  // Count: the group's three, the money item, my proposal and the phone document; never the core action.
  assert.equal(owner.count, '6');
  // Waiting for another person: the proposal another member owns. An approved item is not waiting for a yes.
  assert.equal(owner.waiting, '1');
  assert.deepEqual(owner.phoneDocuments, [{ documentId: 'doc_1', channel: 'whatsapp', mediaType: 'text/csv', receivedAt: '2026-10-01T06:00:00.000Z' }]);

  const accountant = await todayReview({ memberId: 'acct-1', role: 'accountant', epoch: 1, channel: 'desktop' } as Context, host);
  assert.ok(isTodayReviewReply(accountant));
  assert.deepEqual([accountant.items.length, accountant.groups.length, accountant.phoneDocuments.length, accountant.count], [0, 0, 0, '0']);
  assert.equal(accountant.waiting, '8', 'every waiting item and the document wait for the owner');

  // A refusal or a malformed reply leaves the family out; nothing is invented.
  const refused = await todayReview(OWNER, stubHost({ 'approvals.list': Object.assign(new Error('x'), { code: 'FORBIDDEN' }), 'phone.documents.list': { documents: 'no' } }));
  assert.ok(isTodayReviewReply(refused));
  assert.deepEqual([refused.approvals, refused.documents, refused.count, refused.items.length], ['not-built', 'not-built', '0', 0]);
  // The validator refuses one item twice.
  assert.equal(isTodayReviewReply({ ...owner, items: [...owner.items, { ...owner.items[0]!, id: 'writeback:wb_1' }] }), false);
});

test('review join on the real engine: a prepared core action is marked core and a viewer or accountant only waits', async t => {
  const engine = await engineWith(t);
  const prepared = await engine.request('actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-a', text: 'Due Friday.' }, idempotencyKey: 'r4-reminder-a' });
  const owner = await engine.request('todayx.review', {});
  assert.ok(isTodayReviewReply(owner), JSON.stringify(owner));
  assert.deepEqual(owner.items.map((item: any) => [item.id, item.core]), [[`action:${prepared.id}`, true]]);
  assert.equal(owner.count, '0'); assert.equal(owner.waiting, '0');
  for (const role of ['viewer', 'accountant'] as const) {
    const other = await seat(engine, `r4-${role}`, role);
    const seen = await engine.requestAs(other, 'todayx.review', {});
    assert.ok(isTodayReviewReply(seen));
    // Nothing for this seat to act on; whatever waits that it may see waits for the owner.
    const listed = await engine.requestAs(other, 'approvals.list', {});
    assert.deepEqual([seen.items.length, seen.count, seen.waiting], [0, '0', String(listed.items.filter((i: any) => i.state === 'prepared').length)], role);
  }
  await assert.rejects(engine.request('todayx.review', { extra: 1 }), code('INVALID_TODAYX_REQUEST'));
});

/* ------------------------------------------------------------------ worth a look, every kind */

test('worth a look serves every kind from records, at most five, one per episode, moved figures as leads', async () => {
  const alerts = [{ status: 'published', definition: { label: 'Received this week', unit: { kind: 'money', currency: 'INR' } },
    observations: [{ id: 'o1', observedAt: '2026-10-01T04:00:00.000Z', valueMinor: '4107000', receipt: { receiptId: 'receipt_alert_1' } },
      { id: 'o2', observedAt: '2026-10-02T04:00:00.000Z', valueMinor: '3900000', receipt: { receiptId: 'receipt_alert_2' } }],
    episodes: [{ id: 'ep_1', status: 'open', openedAt: '2026-10-01T04:00:00.000Z', observationIds: ['o1', 'o2'] }, { id: 'ep_0', status: 'cleared', openedAt: '2026-09-01T04:00:00.000Z', observationIds: [] }] }];
  const replies = {
    'sources.list': [{ sourceId: 's1', at: '2026-10-01T00:00:00.000Z' }],
    'decisions.journal.due': [],
    'jobsx.missed': [
      { id: 'm1', jobId: 'job_a', at: '2026-10-01T01:00:00.000Z', seen: false }, { id: 'm2', jobId: 'job_a', at: '2026-10-02T01:00:00.000Z', seen: false },
      { id: 'm3', jobId: 'job_b', at: '2026-10-02T02:00:00.000Z', seen: true },
    ],
    'alerts.list': alerts,
    'approvals.list': { items: [], expired: [row('writeback:wb_old', { what: undefined, touches: 'Mail: Kiran Retail Demo', expiresAt: '2026-09-30T05:00:00.000Z' })], snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } },
    'reportsx.weekAhead.late': { briefId: 'brief_1', late: true, builtAt: '2026-09-29T09:00:00.000Z' },
    'release.status': { configured: true, candidate: { version: '0.2.0', dataSchemaVersion: 1 } },
    'reportsx.due': { profile: { kind: 'trader', gstMode: 'regular', state: 'KA' }, covered: true, rows: [{ id: 'gstr3b:2099-01-20', what: 'GSTR-3B', dueOn: '2099-01-20' }] },
  };
  const host = stubHost(replies);
  const reply: any = await worthALookAll(OWNER, host);
  assert.ok(isWorthReply(reply), JSON.stringify(reply));
  assert.equal(reply.rows.length, 5);
  const kinds = reply.rows.map((r: any) => r.kind);
  // Missed while asleep: one row per job, its newest unseen note.
  assert.deepEqual(reply.rows.filter((r: any) => r.kind === 'missed-while-asleep').map((r: any) => r.id), ['missed:m2']);
  const moved = reply.rows.find((r: any) => r.kind === 'moved');
  assert.deepEqual(moved, { id: 'moved:ep_1', kind: 'moved', subject: 'Received this week', at: '2026-10-01T04:00:00.000Z', opens: null,
    figure: { unit: 'paise', exact: '3900000', receiptId: 'receipt_alert_2' }, finding: 'lead-not-tested' });
  assert.ok(kinds.includes('approval-expired'));
  // A late brief is read only from a read that builds nothing; until the reports lane registers it, none is shown.
  assert.equal(kinds.includes('brief-late'), moduleMethods.has('reportsx.weekAhead.late'));
  assert.ok(!host.calls.includes('reportsx.weekAhead'), 'Today never builds a brief');
  // The far due date is past the seven days: not shown.
  assert.ok(!kinds.includes('due-soon'));
  if (!moduleMethods.has('reportsx.weekAhead.late')) assert.equal(kinds.at(-1), 'update-ready', 'an update comes after what changed');
  const all = new Set(reply.rows.map((r: any) => r.id)); assert.equal(all.size, reply.rows.length);

  // Fewer rows: due soon (with a due profile) comes first after setup, an update is shown.
  const near = stubHost({ ...replies, 'jobsx.missed': [], 'alerts.list': [], 'approvals.list': { items: [], expired: [] }, 'reportsx.weekAhead.late': null,
    'reportsx.due': { ...replies['reportsx.due'], rows: [{ id: 'gstr1:soon', what: 'GSTR-1', dueOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) }] } });
  const second: any = await worthALookAll(OWNER, near);
  assert.ok(isWorthReply(second));
  assert.deepEqual(second.rows.map((r: any) => r.kind), ['setup', 'due-soon', 'update-ready'], 'setup not finished keeps the first place');
  assert.equal(second.rows[2].subject, '0.2.0');
  // Without a saved due profile no due date is offered: the table may not apply to this business.
  const unprofiled: any = await worthALookAll(OWNER, stubHost({ ...replies, 'reportsx.due': { ...replies['reportsx.due'], profile: null, rows: [{ id: 'x', what: 'X', dueOn: new Date().toISOString().slice(0, 10) }] } }));
  assert.ok(!unprofiled.rows.some((r: any) => r.kind === 'due-soon'));
  // No source loaded: not loaded yet, nothing else is read.
  const empty = stubHost({ 'sources.list': [] });
  assert.deepEqual(await worthALookAll(OWNER, empty), { rows: [], state: 'not-loaded-yet' });
});

/* ------------------------------------------------------------------ close status */

test('close status: each part from a record or not loaded yet, states only, never a figure', async t => {
  assert.deepEqual(closeMonth('2026-10-15'), { month: '2026-09', from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(closeMonth('2026-01-03'), { month: '2025-12', from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(closeMonth('2024-03-01'), { month: '2024-02', from: '2024-02-01', to: '2024-02-29' });

  const nothing = await closeStatus(OWNER, stubHost({ 'sources.list': [] }));
  assert.ok(isCloseStatusReply(nothing));
  assert.deepEqual(nothing.parts, { bank: 'not-loaded-yet', gstr2b: 'not-loaded-yet', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' });
  const loaded = await closeStatus(OWNER, stubHost({
    'sources.list': [{ sourceId: 'bank', format: 'bank-csv', coverage: { reconciled: false } }],
    'connectorsx.envelopes': [{ sourceId: 'ais', group: 'form26as-ais', operation: 'x', status: 'accepted', committed: { at: 'x' } }],
    'askx.gst2b': { state: 'ready', groups: [{ group: 'matched', count: 4 }, { group: 'in-2b-only', count: 1 }] },
  }));
  assert.ok(isCloseStatusReply(loaded));
  assert.deepEqual(loaded.parts, { bank: 'needs-you', gstr2b: 'needs-you', tds: 'not-started', 'trial-balance': 'not-loaded-yet' });
  assert.ok(Object.values(loaded.parts).every(state => /^[a-z-]+$/.test(state)), "no figure is carried");
  const composition = await closeStatus(OWNER, stubHost({ 'sources.list': [{ format: 'bank-csv', coverage: { reconciled: true } }], 'askx.gst2b': { state: 'not-applicable', reason: 'composition' } }));
  assert.ok(isCloseStatusReply(composition));
  assert.deepEqual([composition.parts.bank, composition.parts.gstr2b, composition.notApplicable], ['in-progress', 'not-applicable', 'composition']);
  const matched = await closeStatus(OWNER, stubHost({ 'sources.list': [], 'askx.gst2b': { state: 'ready', groups: [{ group: 'matched', count: 4 }, { group: 'differs-inside', count: 1 }] } }));
  assert.equal(matched.parts.gstr2b, 'done');

  const engine = await engineWith(t);
  const real = await engine.request('todayx.closeStatus', {});
  assert.ok(isCloseStatusReply(real), JSON.stringify(real));
  assert.equal(real.parts['trial-balance'], 'not-loaded-yet');
  assert.equal(real.parts.gstr2b, 'not-loaded-yet', 'no GSTR-2B lines are loaded');
});

test('close status: a probable match or a line left out needs you, a failed read is not sure, bank statements outside the month do not count', async () => {
  const probable = await closeStatus(OWNER, stubHost({ 'sources.list': [], 'askx.gst2b': { state: 'ready', leftOut: 0, groups: [{ group: 'matched', count: 4 }, { group: 'probable', count: 1 }] } }));
  assert.equal(probable.parts.gstr2b, 'needs-you');
  const leftOut = await closeStatus(OWNER, stubHost({ 'sources.list': [], 'askx.gst2b': { state: 'ready', leftOut: 2, groups: [{ group: 'matched', count: 4 }] } }));
  assert.equal(leftOut.parts.gstr2b, 'needs-you');
  const failed = Object.assign(new Error('x'), { code: 'STORE_BUSY' });
  const unsure = await closeStatus(OWNER, stubHost({ 'sources.list': failed, 'askx.gst2b': failed, 'connectorsx.envelopes': failed }));
  assert.ok(isCloseStatusReply(unsure), JSON.stringify(unsure));
  assert.deepEqual(unsure.parts, { bank: 'not-sure', gstr2b: 'not-sure', tds: moduleMethods.has('connectorsx.envelopes') ? 'not-sure' : 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' });
  const outside = await closeStatus(OWNER, stubHost({ 'sources.list': [{ format: 'bank-csv', period: { from: '2001-01-01', to: '2001-01-31' }, coverage: { reconciled: false } }] }));
  assert.equal(outside.parts.bank, 'not-loaded-yet', 'a statement for another month does not count');
  const inside = await closeStatus(OWNER, stubHost({ 'sources.list': [{ format: 'bank-csv', period: { from: '1990-01-01', to: '2999-12-31' }, coverage: { reconciled: true } }] }));
  assert.equal(inside.parts.bank, 'in-progress');
  const undated = await closeStatus(OWNER, stubHost({ 'sources.list': [{ format: 'bank-csv', coverage: { reconciled: true } }] }));
  assert.equal(undated.parts.bank, 'in-progress', 'a statement with no dates is counted as it is');
  assert.equal(isCloseStatusReply({ month: '2026-09', parts: { bank: 'not-sure', gstr2b: 'done', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' } }), true);
  assert.equal(isCloseStatusReply({ month: '2026-09', parts: { bank: 'maybe', gstr2b: 'done', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' } }), false);
});

/* ------------------------------------------------------------------ cash */

test('cash told by the owner: saved for a day, seven bars, the closing cash part and receipts for a period with none', async t => {
  const engine = await engineWith(t);
  const empty = await engine.request('todayx.cash.week', {});
  assert.ok(isCashWeekReply(empty), JSON.stringify(empty));
  assert.ok(empty.days.every((d: any) => d.paise === null && d.entryId === null));
  const today = empty.day;
  assert.equal((await engine.request('todayx.closing', {})).parts.cash, 'not-loaded-yet');

  // Before cash capture is in use, receipts say nothing about cash.
  const receipt = await engine.request('calculation.run', { operation: 'billed', period });
  assert.equal((await engine.request('todayx.receiptDetail', { receiptId: receipt.id })).cash, undefined);

  const saved = await engine.request('todayx.cash.save', { day: today, paise: '1250000' });
  assert.ok(isCashWeekReply(saved));
  assert.equal(saved.days[6].paise, '1250000'); assert.match(saved.days[6].entryId ?? '', /^cash_/);
  const again = await engine.request('todayx.cash.save', { day: today, paise: '1300000' });
  assert.equal(again.days[6].paise, '1300000', 'the last figure told for a day stands');
  const closing = await engine.request('todayx.closing', {});
  assert.ok(isClosingReply(closing)); assert.equal(closing.parts.cash, 'done');

  // A receipt for a period with no cash told says "cash sales not captured".
  const detail = await engine.request('todayx.receiptDetail', { receiptId: receipt.id });
  assert.ok(isReceiptDetailReply(detail), JSON.stringify(detail)); assert.equal(detail.cash, 'not-captured');
  const week = await engine.request('calculation.run', { operation: 'billed', period: { from: today, to: today } });
  assert.equal((await engine.request('todayx.receiptDetail', { receiptId: week.id })).cash, undefined);

  for (const bad of [{ day: today, paise: '12.50' }, { day: today, paise: 1250 }, { day: '2026-02-30', paise: '1' }, { day: '2099-01-01', paise: '1' }, { day: today, paise: '1', note: 'x' }, { day: '2000-01-01', paise: '1' }])
    await assert.rejects(engine.request('todayx.cash.save', bad), code('INVALID_TODAYX_REQUEST'), JSON.stringify(bad));
  const viewer = await seat(engine, 'r4-cash-viewer', 'viewer');
  await assert.rejects(engine.requestAs(viewer, 'todayx.cash.save', { day: today, paise: '1' }), code('FORBIDDEN'));
  // Only the owner or a cofounder tells the cash, so "told by owner" stays true: an accountant who may prepare is refused.
  const accountant = await seat(engine, 'r4-cash-accountant', 'accountant');
  await assert.rejects(engine.requestAs(accountant, 'todayx.cash.save', { day: today, paise: '1' }), code('FORBIDDEN'));
  assert.ok(isCashWeekReply(await engine.requestAs(viewer, 'todayx.cash.week', {})));
  // Told cash is a statement in Activity, not a fact: no fact or source was added.
  const sources = await engine.request('sources.list', {});
  assert.equal(sources.length, 1);
  const activity = await engine.request('todayx.activity', {});
  assert.ok(activity.events.some((e: any) => e.type === 'cash.told' && e.actor.kind === 'you'));
});

/* ------------------------------------------------------------------ activity by job and record */

test('activity filters by job and by record, and checks both', async t => {
  const engine = await engineWith(t);
  const bySource = await engine.request('todayx.activity', { record: 'synthetic-export' });
  assert.ok(isActivityReply(bySource));
  assert.ok(bySource.events.length > 0 && bySource.events.every((e: any) => Object.values(e.values).includes('synthetic-export')));
  const none = await engine.request('todayx.activity', { record: 'customer-z' });
  assert.equal(none.events.length, 0); assert.equal(none.total, '0');
  const noJob = await engine.request('todayx.activity', { job: 'job_missing' });
  assert.equal(noJob.events.length, 0);
  await assert.rejects(engine.request('todayx.activity', { record: '' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.activity', { job: 'a b' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.activity', { customer: 'x' }), code('INVALID_TODAYX_REQUEST'));
});
