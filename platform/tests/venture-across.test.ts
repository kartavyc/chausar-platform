// Ink v2 wave 4, package 4J6: money and runs across the businesses on this computer (W3's business chips and runs
// across businesses, 4C1's questions about another business, 4J8's "You run this", catalogue C10's never-contact list).
// The open business is read live, with its own receipts; each other one comes from the summary Chausar saved when it was
// last open, every figure "as of" then, with a receipt here that says so (its own receipts open only after switching).
// A business that opens with a passphrase shows nothing. A total adds only one currency, in BigInt from the minor
// amounts. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  AcrossMoneyView, AcrossRunsView, BusinessSnapshot, BusinessSnapshotRead, SumReceiptRecord, VentureDeps, VentureRecord, WaysView,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { businessSnapshot } from '../runtime/venture/money/across.ts';
import { venturePlaybooks } from '../runtime/venture/host.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { add, leadCall, leadDeps, withPeople } from './venture-pipeline-env.ts';
import { net } from './venture-network-env.ts';
import { chatConsent, chiefBusiness, scriptChief } from './venture-chief-helpers.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';

const figure = (amount: string, display: string, receiptId: string, unit: 'minor' | 'micros' = 'minor', currency = 'INR') => ({ amount, unit, currency, display, receiptId });

/** Another business's summary, saved at 10:30 on 21 Oct 2026 in Kolkata (05:00 UTC). */
function saved(id: string, name: string, overrides: Partial<BusinessSnapshot> = {}, currency = 'INR'): BusinessSnapshot {
  return {
    format: 'chausar.snapshot.v1', businessId: id, vaultId: `vault_${id}`, name, playbook: 'youtube', asOf: '2026-10-21T05:00:00.000Z',
    money: {
      month: '2026-10', currency,
      invoiced: figure('4500000', `${currency} 45,000.00`, 'their_sum_1', 'minor', currency),
      received: figure('1200000', `${currency} 12,000.00`, 'their_sum_2', 'minor', currency),
      owed: figure('5310000', `${currency} 53,100.00`, 'their_sum_3', 'minor', currency), late: 2,
      spend: figure('1250000', 'USD 1.2500', 'their_sum_4', 'micros', 'USD'),
    },
    runs: { working: 1, waiting: 2, stopped: 1 }, needsYou: 3,
    ...overrides,
  };
}
const ref = (id: string, name: string, opens: BusinessSnapshotRead['opens'] = 'with-this-computer') => ({ id, name, opens, openedAt: '2026-10-21T05:00:00.000Z' });

/** The workspace stub of the views tests, with the summaries a test lists. */
function withSnapshots(env: { deps: VentureDeps }, reads: BusinessSnapshotRead[]): void {
  Object.assign(env.deps.workspace!, { snapshots: async () => reads });
}

const moneyOf = (env: GoalEnv) => env.money<AcrossMoneyView>('venture.money.across', {});
const runsOf = (env: Env) => (viewHandlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)['venture.runs.across'](env.deps, owner, {}) as Promise<AcrossRunsView>;

/**
 * Today is 23 Oct 2026 in Kolkata. Two invoices of one month at INR 19,750.00 before tax, plus GST 18%: 2330500 each.
 * - issued 20 Oct, due 4 Nov: not due.
 * - issued 1 Oct, due 16 Oct: 7 days late; INR 1,000.00 paid on 20 Oct, so 2230500 is left.
 * Invoiced in October before tax 1975000 x 2 = 3950000 (INR 39,500.00); received 100000 (INR 1,000.00); owed
 * 2330500 + 2230500 = 4561000 (INR 45,610.00); one late.
 */
async function business() {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-10-20');
  const late = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: late.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  return env;
}

test('the open business\'s summary: its totals as code added them, each with its receipt, counts of runs and of what needs you, and no client\'s words', async () => {
  const env = await business();
  const made = await businessSnapshot(env.deps, owner);
  assert.ok(made);
  const { snapshot, neverContact } = made;
  assert.deepEqual([snapshot.name, snapshot.playbook, snapshot.asOf], ['Ledger Cafe Books', snapshot.playbook, '2026-10-23T10:00:00.000Z']);
  const money = snapshot.money!;
  assert.deepEqual([money.month, money.currency, money.late], ['2026-10', 'INR', 1]);
  assert.deepEqual([money.invoiced.amount, money.invoiced.display], ['3950000', 'INR 39,500.00']);
  assert.deepEqual([money.received.amount, money.received.display], ['100000', 'INR 1,000.00']);
  assert.deepEqual([money.owed.amount, money.owed.display], ['4561000', 'INR 45,610.00']);
  assert.deepEqual([money.spend.amount, money.spend.unit, money.spend.currency], ['0', 'micros', 'USD']);
  for (const item of [money.invoiced, money.received, money.owed, money.spend]) {
    const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: item.receiptId });
    assert.equal(receipt.figures[0].display, item.display, 'each figure is its receipt\'s');
  }
  assert.deepEqual(snapshot.runs, { working: 0, waiting: 0, stopped: 0 });
  assert.equal(typeof snapshot.needsYou, 'number');
  assert.deepEqual(neverContact, [], 'nobody is blocked yet');
  const text = JSON.stringify(snapshot);
  for (const word of ['Cafe Aroma', 'aroma.example', 'Close the month']) assert.equal(text.includes(word), false, word);
});

test('venture.money.across: the open business live, the others as saved with "as of", the locked one with nothing, and a total in one currency with its receipt', async () => {
  const env = await business();
  withSnapshots(env, [
    { ...ref('lumen-studio', 'Lumen Studio'), read: 'saved', snapshot: saved('lumen-studio', 'Lumen Studio') },
    { ...ref('sitara-events', 'Sitara Events', 'needs-passphrase'), read: 'locked', snapshot: null },
    { ...ref('neon-desk', 'Neon Desk'), read: 'saved', snapshot: saved('neon-desk', 'Neon Desk', { asOf: '2026-09-28T05:00:00.000Z', money: { ...saved('x', 'x').money!, month: '2026-09' } }) },
    { ...ref('broken-books', 'Broken Books'), read: 'unreadable', snapshot: null },
    { ...ref('new-shop', 'New Shop'), read: 'none', snapshot: null },
  ]);
  const view = await moneyOf(env);
  const [open, lumen, sitara, neon, broken, fresh] = view.businesses;
  assert.deepEqual([open.businessId, open.name, open.open, open.locked, open.asOf, open.line], ['main', 'Ledger Cafe Books', true, false, null, 'Open now.']);
  assert.deepEqual([open.invoiced, open.received, open.owed, open.late], ['INR 39,500.00', 'INR 1,000.00', 'INR 45,610.00', 1]);
  for (const key of ['invoiced', 'received', 'owed', 'spend'] as const) assert.ok(open.receipts?.[key], key);

  assert.deepEqual([lumen.open, lumen.locked, lumen.asOf, lumen.line], [false, false, '2026-10-21T05:00:00.000Z', 'As of 21 Oct 2026, 10:30, when you last opened it.']);
  assert.deepEqual([lumen.invoiced, lumen.received, lumen.owed, lumen.late, lumen.spend], ['INR 45,000.00', 'INR 12,000.00', 'INR 53,100.00', 2, 'USD 1.2500']);
  // Its figures open here as receipts of what was saved; its own receipts open only in Lumen Studio.
  const theirs = await env.money<SumReceiptRecord>('venture.receipt.get', { id: lumen.receipts!.invoiced! });
  assert.equal(theirs.figures[0].display, 'INR 45,000.00');
  assert.equal(theirs.explanation, '1 saved figure: Lumen Studio, as saved on 21 Oct 2026, 10:30 INR 45,000.00. Added together: INR 45,000.00.');
  assert.ok(!Object.values(lumen.receipts!).some(id => id.startsWith('their_sum')), 'another business\'s receipt ids never reach this one');

  assert.deepEqual([sitara.locked, sitara.asOf, sitara.invoiced, sitara.receipts], [true, null, null, undefined]);
  assert.equal(sitara.line, 'Sitara Events is locked with a passphrase, so Chausar shows nothing about it until you open it.');
  assert.equal(neon.line, 'As of 28 Sep 2026, 10:30, when you last opened it.');
  assert.deepEqual([broken.locked, broken.invoiced, broken.line], [false, null, "Couldn't read what Chausar saved about Broken Books."]);
  assert.deepEqual([fresh.invoiced, fresh.line], [null, 'Chausar has nothing saved about New Shop yet. Open it once and it shows here.']);

  // 3950000 (Ledger Cafe Books) + 4500000 (Lumen Studio) = 8450000. Neon Desk's figure is September's, so it is left out.
  assert.equal(view.total!.display, 'INR 84,500.00');
  assert.equal(view.line, 'Invoiced in October 2026 across 2 businesses. Not counted: Sitara Events (locked), Neon Desk (saved in September 2026), Broken Books (could not be read), New Shop (nothing saved yet).');
  // The same in parts, so a screen can word it in Hindi.
  assert.deepEqual(view.businesses.map(row => row.lineKey), ['open', 'as-of', 'locked', 'as-of', 'unreadable', 'none']);
  assert.deepEqual([view.lineKey, view.month, view.counted, view.currencies], ['counted', '2026-10', 2, ['INR']]);
  assert.deepEqual(view.notCounted.map(item => [item.businessId, item.why, item.month]), [
    ['sitara-events', 'locked', null], ['neon-desk', 'other-month', '2026-09'], ['broken-books', 'unreadable', null], ['new-shop', 'none', null],
  ]);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.total!.receiptId });
  assert.equal(receipt.totalMinor, '8450000');
  assert.deepEqual(receipt.addends.map(item => item.recordId).slice(-1), ['snapshot:lumen-studio']);
  assert.match(receipt.explanation, /Lumen Studio, as saved on 21 Oct 2026, 10:30 INR 45,000\.00/);
  assert.equal(receipt.stale, false);
  // The open business's part is its own records: a new invoice makes the total read stale.
  await invoice(env, '1', '2026-10-22');
  assert.equal((await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.total!.receiptId })).stale, true);
  assert.equal((await moneyOf(env)).total!.display, 'INR 104,250.00', '3950000 + 1975000 + 4500000 = 10425000');
});

test('businesses that bill in other currencies are never added together, and the line says so', async () => {
  const env = await business();
  withSnapshots(env, [{ ...ref('london-walks', 'London Walks'), read: 'saved', snapshot: saved('london-walks', 'London Walks', {}, 'GBP') }]);
  const view = await moneyOf(env);
  assert.equal(view.total, null);
  assert.equal(view.businesses[1].invoiced, 'GBP 45,000.00');
  assert.equal(view.line, 'Your businesses bill in GBP and INR, so Chausar does not add them together.');
  assert.deepEqual([view.lineKey, view.currencies], ['currencies', ['GBP', 'INR']]);
});

test('alone on this computer, or on the hosted app (no summaries), the across views show the open business only', async () => {
  const env = await business();
  const view = await moneyOf(env);
  assert.equal(view.businesses.length, 1);
  assert.equal(view.total!.display, 'INR 39,500.00');
  assert.equal(view.line, 'Invoiced in October 2026 in 1 business.');
  delete (env.deps as { workspace?: unknown }).workspace;
  assert.equal((await moneyOf(env)).businesses.length, 1);
  await assert.rejects(env.money('venture.money.across', { scope: 'all' }), code('INVALID_VENTURE_REQUEST'));
});

test('venture.runs.across: counts the open business live and the others as saved; a locked one shows no counts', async () => {
  const env = await setup();
  withSnapshots(env, [
    { ...ref('lumen-studio', 'Lumen Studio'), read: 'saved', snapshot: saved('lumen-studio', 'Lumen Studio') },
    { ...ref('sitara-events', 'Sitara Events', 'needs-passphrase'), read: 'locked', snapshot: null },
  ]);
  const view = await runsOf(env);
  const [open, lumen, sitara] = view.businesses;
  assert.deepEqual([open.open, open.working, open.waiting, open.stopped], [true, 0, 0, 0]);
  assert.deepEqual([lumen.working, lumen.waiting, lumen.stopped, lumen.needsYou, lumen.line], [1, 2, 1, 3, 'As of 21 Oct 2026, 10:30, when you last opened it.']);
  assert.deepEqual([sitara.working, sitara.needsYou, sitara.locked, sitara.lineKey], [null, null, true, 'locked']);
  assert.deepEqual(view.totals, { working: 1, waiting: 2, stopped: 1, needsYou: 3 + (open.needsYou ?? 0), businesses: 2 });
  assert.deepEqual(view.notCounted, [{ businessId: 'sitara-events', name: 'Sitara Events', why: 'locked', month: null }]);
  assert.equal(view.line, `1 running, 2 waiting, 1 stopped and ${3 + (open.needsYou ?? 0)} need you across 2 businesses. Not counted: Sitara Events (locked).`);
});

test('a business still in its interview (no country yet) has no money to show, and its summary says so', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'admin', 'seed.no-country', tx => tx.replace<VentureRecord>({ ...tx.venture!, country: null as never }));
  const made = await businessSnapshot(env.deps, owner);
  assert.equal(made!.snapshot.money, null);
  const view = await (moneyHandlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)['venture.money.across'](env.deps, owner, {}) as AcrossMoneyView;
  assert.deepEqual([view.businesses[0].invoiced, view.businesses[0].line, view.total], [null, 'Finish setting up this business to see its money here.', null]);

  // Still in setup, it adds up the others for this month (October 2026, on the UTC calendar while it has no country):
  // a September summary is left out, whichever comes first.
  withSnapshots(env, [
    { ...ref('neon-desk', 'Neon Desk'), read: 'saved', snapshot: saved('neon-desk', 'Neon Desk', { money: { ...saved('x', 'x').money!, month: '2026-09' } }) },
    { ...ref('lumen-studio', 'Lumen Studio'), read: 'saved', snapshot: saved('lumen-studio', 'Lumen Studio') },
  ]);
  const others = await (moneyHandlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)['venture.money.across'](env.deps, owner, {}) as AcrossMoneyView;
  assert.equal(others.total!.display, 'INR 45,000.00');
  assert.equal(others.line, 'Invoiced in October 2026 in 1 business. Not counted: Neon Desk (saved in September 2026).');
});

test('never-contact (C10): a draft to an address another business keeps out is OUTREACH_BLOCKED; the business\'s own blocklist joins the list; Forget adds the person', async () => {
  const env = await setup();
  const listed = new Set<string>();
  const added: string[][] = [];
  Object.assign(env.deps.workspace!, {
    neverContact: {
      has: async (values: readonly string[]) => values.some(value => listed.has(value.trim().toLowerCase())),
      add: async (values: readonly string[]) => { added.push([...values]); },
    },
  });
  const p = await withPeople(env);
  await net(env, 'venture.network.know', { personId: p.asha.id, how: 'well' });
  const card = (await add(env, p.asha)).card;
  listed.add('asha@dewdrop.example');
  await assert.rejects(net(env, 'venture.outreach.draft', { opportunityId: card.id, kind: 'follow-up', channel: 'email' }), (error: any) => {
    assert.equal(error.code, 'OUTREACH_BLOCKED');
    assert.equal(error.message, 'Asha Rao is on the never-contact list of your businesses on this computer.');
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-outreach').length, 0);
  listed.clear();
  const made = await net<any>(env, 'venture.outreach.draft', { opportunityId: card.id, kind: 'follow-up', channel: 'email' });
  // Listed after drafting: opening the handoff is refused too.
  listed.add('asha@dewdrop.example');
  await assert.rejects(net(env, 'venture.outreach.open', { draftId: made.draft.id }), code('OUTREACH_BLOCKED'));
  // A key that does not answer: the list refuses, and nothing is drafted.
  (env.deps.workspace as any).neverContact.has = async () => { throw Object.assign(new Error("Chausar can't check your never-contact list on this computer right now, so it drafts nothing. Try again in a moment."), { code: 'TIER_UNAVAILABLE' }); };
  await assert.rejects(net(env, 'venture.outreach.draft', { opportunityId: card.id, kind: 'follow-up', channel: 'email' }), code('TIER_UNAVAILABLE'));

  // The business's own blocklist goes into its summary's never-contact part (the engine adds it to the shared list).
  await leadCall(leadDeps(env), 'venture.leads.block', { value: 'rahul@mehta.example' });
  await leadCall(leadDeps(env), 'venture.leads.block', { value: '+919900122334' });
  await leadCall(leadDeps(env), 'venture.leads.block', { value: 'mehta.example' });
  // Whole addresses and handles only: a blocked domain stays this business's own rule.
  assert.deepEqual((await businessSnapshot(env.deps, owner))!.neverContact, ['+919900122334', 'rahul@mehta.example']);

  // A caller who may not forget blocks no one: the approve level is read before anything joins the shared list.
  const calls = added.length;
  await assert.rejects(net(env, 'venture.network.forget', { id: p.farhan.id }, { memberId: 'stranger', role: 'viewer', epoch: 1, channel: 'desktop' } as never));
  assert.equal(added.length, calls, 'nothing added for a refused caller');
  // Forget: the person's emails, phones and LinkedIn page join the shared list, as keyed checks the host makes.
  const handles =[...p.farhan.handles.emails, ...p.farhan.handles.phones, ...(p.farhan.handles.linkedinUrl ? [p.farhan.handles.linkedinUrl] : [])];
  const forgotten = await net<{ line: string; kept: string[] }>(env, 'venture.network.forget', { id: p.farhan.id });
  assert.deepEqual(added.at(-1), handles);
  const shared = "A second one-way check, made with this computer's key, stops every business on this computer from drafting to them.";
  assert.deepEqual(forgotten.kept.slice(-2), [shared, 'Backups made before now still hold this person until those backups are deleted.']);
  // When the shared check can't be made, Forget still forgets, and says so.
  (env.deps.workspace as any).neverContact.add = async () => { throw Object.assign(new Error('no key'), { code: 'NEVER_CONTACT_LOST' }); };
  const second = await net<{ line: string; kept: string[] }>(env, 'venture.network.forget', { id: p.rahul.id });
  assert.equal(second.kept.at(-2), "Chausar couldn't make the shared check on this computer, so another business here could still draft to them.");
  assert.equal(listRecords(env.store.read(), 'venture-person').some(person => person.id === p.rahul.id), false, 'forgotten all the same');
});

test('never-contact (C10): a lead\'s own cold email is refused before it is drafted', async () => {
  const env = await setup();
  Object.assign(env.deps.workspace!, { neverContact: { has: async (values: readonly string[]) => values.includes('nia@nia.example'), add: async () => {} } });
  const deps = leadDeps(env);
  const lead = await leadCall<{ id: string }>(deps, 'venture.leads.add', { name: 'Nia', email: 'nia@nia.example', sourceUrl: 'https://directory.example/pune/cafes' });
  await assert.rejects(leadCall(deps, 'venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' }), (error: any) => {
    assert.equal(error.code, 'OUTREACH_BLOCKED');
    assert.equal(error.message, 'Nia is on the never-contact list of your businesses on this computer.');
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-lead')[0].drafts.length, 0, 'nothing drafted');
});

test('chief: a question about a business that opens with this computer is answered from its summary, every figure as of when it was saved; a locked one is still never read', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  env.others([
    { id: 'biz_sitara', name: 'Sitara Events', opens: 'needs-passphrase', openedAt: null },
    { id: 'biz_lumen', name: 'Lumen Studio', opens: 'with-this-computer', openedAt: '2026-10-20T09:00:00.000Z' },
    { id: 'biz_fresh', name: 'Fresh Bakes', opens: 'with-this-computer', openedAt: null },
  ]);
  withSnapshots(env, [
    { ...ref('biz_sitara', 'Sitara Events', 'needs-passphrase'), read: 'locked', snapshot: null },
    { ...ref('biz_lumen', 'Lumen Studio'), read: 'saved', snapshot: saved('biz_lumen', 'Lumen Studio') },
    { ...ref('biz_fresh', 'Fresh Bakes'), read: 'none', snapshot: null },
  ]);
  const tasks = scriptChief(env, []);
  const locked = await env.chief('venture.chief.thread.send', { text: 'How is Sitara Events doing this month?' });
  assert.deepEqual(locked.added[1].parts, [{ kind: 'text', text: 'Sitara Events is locked. Open it to ask about it.' }]);
  const lumen = await env.chief('venture.chief.thread.send', { text: 'What did lumen studio invoice?' });
  const parts = lumen.added[1].parts;
  assert.equal(parts[0].text, 'Lumen Studio, as of 21 Oct 2026, 10:30, when you last opened it:');
  const figures = parts.filter((part: any) => part.kind === 'figure');
  assert.deepEqual(figures.map((part: any) => part.display), ['INR 45,000.00', 'INR 12,000.00', 'INR 53,100.00', 'USD 1.2500']);
  for (const part of figures) assert.ok(listRecords(env.store.read(), 'venture-sum-receipt').some(receipt => receipt.id === part.receiptId), 'each figure has its receipt here');
  assert.equal(parts.at(-1).text, '2 invoices late, 1 running, 2 waiting, 1 stopped, 3 need you. Open Lumen Studio to see its own receipts.');
  const fresh = await env.chief('venture.chief.thread.send', { text: 'How is Fresh Bakes doing?' });
  assert.deepEqual(fresh.added[1].parts, [{ kind: 'text', text: 'Chausar has nothing saved about Fresh Bakes yet. Open it once to ask about it.' }]);
  assert.equal(tasks.length, 0, 'answered by code: nothing is sent to the AI');
});

test('"You run this": the ways to earn list the businesses whose summaries name their playbook, beside the open one', async () => {
  const ways = await venturePlaybooks({}, null, [{ businessId: 'lumen-studio', name: 'Lumen Studio', playbook: 'youtube' }]);
  const youtube = ways.ways.find(way => way.playbook === 'youtube') as WaysView['ways'][number];
  assert.deepEqual(youtube.yours, [{ businessId: 'lumen-studio', name: 'Lumen Studio' }]);
});
