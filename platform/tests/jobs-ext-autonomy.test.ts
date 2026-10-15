import test from 'node:test';
import { lane } from '../runtime/jobs-ext/state.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { jobsExtModule } from '../runtime/modules/lane-jobs-ext.ts';
import { autonomyTick } from '../runtime/jobs-ext/autonomy-methods.ts';
import { ALWAYS_WAITS, ALWAYS_WAITS_WORDS, alwaysWaits, kindTable, switchable } from '../runtime/jobs-ext/autonomy.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const KIND = 'local.reminder-draft';
// Until the coordinator wires `tick` into the lane module, the test attaches the exported tick itself.
if (!jobsExtModule.tick) (jobsExtModule as { tick?: unknown }).tick = autonomyTick;

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-autonomy-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => {
    await engine.shutdown(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-autonomy-')); await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic autonomy shop', passphrase: 'Synthetic-autonomy-passphrase', demo: false });
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  return engine;
}
const prepareByHand = (engine: Engine, n: number, ctx: Context = owner) => engine.requestAs(ctx, 'actions.prepare', { connector: 'local', operation: 'reminder-draft',
  payload: { invoiceId: `inv-${n}`, text: 'Synthetic reminder' }, idempotencyKey: `synthetic-key-${n}` });
/** As a lane job prepares it: the lane records the reminder it prepared. */
async function prepare(engine: Engine, n: number, ctx: Context = owner) {
  const action = await prepareByHand(engine, n, ctx);
  await (engine as any).store().update((state: any) => { lane(state).reminders.push({ customerId: `cust-${n}`, invoiceId: `inv-${n}`, day: '2026-10-05', actionId: action.id, jobId: 'synthetic-job', key: action.idempotencyKey, ownerId: action.createdBy }); });
  return action;
}
async function refused(work: Promise<unknown>, code: string) { await assert.rejects(work, (error: any) => { assert.equal(error.code, code); return true; }); }
const status = async (engine: Engine, id: string) => (await engine.request('actions.list')).find((a: any) => a.id === id).status;
const autoRuns = (results: any[]) => results.filter(r => r && typeof r.actionId === 'string');

test('the classification table: reversible local kinds are switchable, the always-waits words never are', () => {
  assert.equal(switchable(KIND, 'reversible'), true);
  for (const kind of ['shop.update-price', 'shop.set_stock', 'store.listing-edit', 'writeback.whatsapp.payment-reminder', 'books.delete-entry', 'mail.send',
    'shop.product-status', 'gst.gst-file', 'drive.share', 'team.invite', 'hooks.webhook-create', 'bank.payout']) assert.equal(alwaysWaits(kind), true, kind);
  assert.equal(switchable('bank.match-statement', 'reversible'), true);
  assert.equal(switchable('bank.match-statement', 'money'), false, 'Only reversible kinds have a switch.');
  assert.equal(switchable('bank.match-statement', 'reversible', true), false, 'A writeback row may say it always waits.');
  assert.ok(ALWAYS_WAITS_WORDS.includes('refund') && ALWAYS_WAITS_WORDS.includes('telegram'));
  assert.equal(ALWAYS_WAITS.intro, 'Anything that cannot be undone, and in particular:');
  assert.equal(ALWAYS_WAITS.items.at(-1), 'tax filings (prepare only)');
});

test('writeback catalogue rows are validated defensively and a missing method is skipped', async () => {
  const actions = { catalogue: () => [{ id: 'local', operations: [{ id: 'reminder-draft', title: 'Draft', impact: 'reversible' }] }] };
  const absent = await kindTable(owner, { services: { actions }, call: async () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); } });
  assert.deepEqual([...absent.keys()], [KIND]);
  const rows = [{ system: 'sheets', action: 'append-row', impact: 'reversible' }, { system: 'sheets', action: 'note-row', impact: 'reversible', alwaysWaits: true },
    { system: 'tally', action: 'post-voucher' }, { system: '../x', action: 'y' }, { system: 'a', action: 'b', impact: 'free' }, null, 'junk', { system: 'a', action: 'c', alwaysWaits: 'yes' }];
  const table = await kindTable(owner, { services: { actions }, call: async () => rows });
  assert.deepEqual([...table.keys()].sort(), [KIND, 'writeback.sheets.append-row', 'writeback.sheets.note-row', 'writeback.tally.post-voucher']);
  assert.equal(table.get('writeback.sheets.append-row')!.switchable, true);
  assert.equal(table.get('writeback.sheets.note-row')!.switchable, false);
  assert.equal(table.get('writeback.tally.post-voucher')!.impact, 'destructive', 'A row without an impact is treated as one that cannot be undone.');
});

test('a new install asks before everything; always-waits kinds have no switch; presets and caps', async t => {
  const engine = await fixture(t);
  // A synthetic connector with kinds that always wait. Its operations are never executed here.
  const never = async () => { throw new Error('Synthetic connector must not run.'); };
  const op = (title: string, impact: string) => ({ title, description: 'Synthetic fixture only.', impact, idempotency: 'key', readback: 'read', validate: (p: any) => p, execute: never, reconcile: never });
  (engine as any).services.actions.registry.set('synthetic-shop', { id: 'synthetic-shop', title: 'Synthetic shop', operations: {
    'update-price': op('Change a price', 'reversible'), 'pay-supplier': op('Pay a supplier', 'money'), 'match-statement': op('Match a statement line', 'reversible') } });
  const fresh = await engine.request('jobsx.autonomy');
  assert.equal(fresh.master, false); assert.equal(fresh.preset, 'ask-everything');
  assert.ok(fresh.kinds.length > 0 && fresh.kinds.every((k: any) => k.on === false && k.usedToday === 0));
  assert.deepEqual(fresh.alwaysWaits, { intro: ALWAYS_WAITS.intro, items: [...ALWAYS_WAITS.items] });
  assert.equal(fresh.caps.activeJobCap, 10);
  const draft = fresh.kinds.find((k: any) => k.kind === KIND); assert.equal(draft.switchable, true); assert.equal(draft.impact, 'reversible');
  const waiting = fresh.kinds.filter((k: any) => !k.switchable);
  // Outside the local connector, a reversible kind still waits until the writeback catalogue confirms it can be undone.
  assert.deepEqual(waiting.map((k: any) => k.kind).sort(), ['synthetic-shop.match-statement', 'synthetic-shop.pay-supplier', 'synthetic-shop.update-price']);
  for (const kind of waiting) await refused(engine.request('jobsx.setAutonomy', { kind: kind.kind, on: true }), 'ALWAYS_WAITS');
  assert.deepEqual((await engine.request('jobsx.setAutonomy', { kind: 'synthetic-shop.update-price', on: false })).on, false);
  await refused(engine.request('jobsx.setAutonomy', { kind: 'nowhere.unknown', on: true }), 'UNSUPPORTED_ACTION');
  await refused(engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 0 }), 'INVALID_AUTONOMY');
  await refused(engine.request('jobsx.setAutonomy', { kind: KIND, on: true, extra: 1 }), 'INVALID_AUTONOMY');
  await refused(engine.requestAs({ ...owner, sourceTainted: true }, 'jobsx.setAutonomy', { kind: KIND, on: true }), 'APP_APPROVAL_REQUIRED');
  await refused(engine.requestAs({ ...owner, channel: 'phone' }, 'jobsx.setAutonomy', { kind: KIND, on: true }), 'OPEN_DESKTOP');

  assert.deepEqual(await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 5 }), { kind: KIND, on: true, dailyCount: 5, dailyAmountMinor: '0', preset: 'custom' });
  let view = await engine.request('jobsx.autonomy');
  assert.equal(view.preset, 'custom'); assert.deepEqual(view.kinds.find((k: any) => k.kind === KIND).on, true);
  assert.equal(view.master, false, 'A kind switch never turns the master switch on.');

  assert.deepEqual((await engine.request('jobsx.autonomyPreset', { preset: 'ask-everything' })).on, []);
  const routine = await engine.request('jobsx.autonomyPreset', { preset: 'routine' });
  assert.deepEqual(routine.on, ['local.reminder-draft']);
  const all = await engine.request('jobsx.autonomyPreset', { preset: 'all-but-always-waits' });
  view = await engine.request('jobsx.autonomy');
  assert.equal(view.preset, 'all-but-always-waits');
  assert.deepEqual(all.on, view.kinds.filter((k: any) => k.switchable).map((k: any) => k.kind).sort());
  assert.ok(view.kinds.filter((k: any) => !k.switchable).every((k: any) => !k.on));
  assert.equal(view.master, false, 'Presets never change the master switch.');
  await refused(engine.request('jobsx.autonomyPreset', { preset: 'everything' }), 'INVALID_AUTONOMY');
  await refused(engine.requestAs({ ...owner, sourceTainted: true }, 'jobsx.autonomyPreset', { preset: 'routine' }), 'APP_APPROVAL_REQUIRED');

  assert.equal((await engine.request('jobsx.setCaps', { activeJobCap: 12, groupMax: 50 })).activeJobCap, 12);
  assert.equal((await engine.request('jobsx.caps')).groupMax, 50);
  await refused(engine.request('jobsx.setCaps', { activeJobCap: 51 }), 'INVALID_CAPS');
  await refused(engine.request('jobsx.setCaps', { reminderPerCustomerPerDay: 1.5 }), 'INVALID_CAPS');
  await refused(engine.request('jobsx.setCaps', { backgroundMode: true }), 'INVALID_CAPS');
  await refused(engine.request('jobsx.setCaps', {}), 'INVALID_CAPS');
  await refused(engine.requestAs({ ...owner, sourceTainted: true }, 'jobsx.setCaps', { failureLimit: 2 }), 'APP_APPROVAL_REQUIRED');
});

test('auto-run: master switch, kind switch, daily count, taint and agreement', async t => {
  const engine = await fixture(t);
  const first = await prepare(engine, 1);
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 1 });
  assert.deepEqual(autoRuns(await engine.tick()), [], 'With the master switch off nothing runs.');
  assert.equal(await status(engine, first.id), 'prepared');

  await engine.request('trust.update', { autonomy: true });
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: false });
  assert.deepEqual(autoRuns(await engine.tick()), [], 'A kind that is switched off waits.');
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 1 });

  const second = await prepare(engine, 2);
  const ran = autoRuns(await engine.tick());
  assert.equal(ran.length, 1); assert.equal(ran[0].actionId, first.id); assert.equal(ran[0].kind, KIND); assert.equal(ran[0].status, 'verified');
  assert.equal(await status(engine, first.id), 'verified');
  assert.equal(await status(engine, second.id), 'prepared', 'The daily count holds.');
  assert.deepEqual(autoRuns(await engine.tick()), []);
  let view = await engine.request('jobsx.autonomy');
  assert.equal(view.kinds.find((k: any) => k.kind === KIND).usedToday, 1);

  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 10 });
  const tainted = await engine.requestAs({ ...owner, sourceTainted: true }, 'actions.prepare', { connector: 'local', operation: 'reminder-draft',
    payload: { invoiceId: 'inv-3', text: 'Synthetic reminder from imported text' }, idempotencyKey: 'synthetic-key-3' });
  const next = autoRuns(await engine.tick());
  assert.deepEqual(next.map(r => r.actionId), [second.id]);
  assert.equal(await status(engine, tainted.id), 'prepared', 'An action prepared from imported text never runs on its own.');
  assert.deepEqual(autoRuns(await engine.tick()), []);
  const activity = (engine as any).store().read().activity.filter((e: any) => e.event === 'jobsx.autonomy.ran');
  assert.deepEqual(activity.map((e: any) => e.details.actionId), [first.id, second.id]);

  // Agreement counts only what a person decided, not what the rule ran.
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: false });
  const manual = await prepare(engine, 4);
  await engine.request('actions.approve', { id: manual.id, digest: manual.digest });
  const declined = await prepare(engine, 5);
  await engine.withContext(owner, () => (engine as any).services.actions.cancel(owner, declined.id));
  view = await engine.request('jobsx.autonomy');
  assert.deepEqual(view.kinds.find((k: any) => k.kind === KIND).agreement, { approved: 1, declined: 1 });

  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyCount: 10 });
  await engine.request('trust.update', { autonomy: false });
  const later = await prepare(engine, 6);
  assert.deepEqual(autoRuns(await engine.tick()), []);
  assert.equal(await status(engine, later.id), 'prepared', 'Turning the master switch off stops every kind.');
});

test('only work a job prepared runs on its own: a hand-, plugin- or assistant-prepared action of a switched-on kind waits', async t => {
  const engine = await fixture(t);
  await engine.request('trust.update', { autonomy: true });
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true });
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const byHand = await prepareByHand(engine, 41);
  const viaAssistant = await prepareByHand(engine, 42, { ...owner, channel: 'mcp' });
  const byJob = await prepare(engine, 43);
  await engine.tick();
  const actions = await engine.request('actions.list');
  const status = (id: string) => actions.find((a: any) => a.id === id).status;
  assert.equal(status(byHand.id), 'prepared'); assert.equal(status(viaAssistant.id), 'prepared');
  assert.equal(status(byJob.id), 'verified');
});

test('a job’s action cannot be claimed by guessing: a hand-made action with a recorded id but another key, invoice or author waits', async t => {
  const engine = await fixture(t);
  await engine.request('trust.update', { autonomy: true });
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true });
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const forged = await prepareByHand(engine, 51);
  await (engine as any).store().update((state: any) => { lane(state).reminders.push({ customerId: 'cust-51', invoiceId: 'inv-other', day: '2026-10-05', actionId: forged.id, jobId: 'synthetic-job', key: forged.idempotencyKey, ownerId: 'owner' }); });
  await engine.tick();
  assert.equal((await engine.request('actions.list')).find((a: any) => a.id === forged.id).status, 'prepared', 'the invoice does not match what the job recorded');
});

test('the always-waits words also catch plurals, tenses, acronyms and non-ASCII names', () => {
  for (const kind of ['shop.sendInvites', 'hooks.webhooks', 'crm.deleting-records', 'bank.payouts', 'msg.SMSReminder', 'shop.listProduct', 'shop.publish-product', 'books.void-invoice', 'drive.shared-link', 'gst.gstr1-submit', 'shop.set-qty', 'local.dеlete'])
    assert.equal(alwaysWaits(kind), true, kind);
  assert.equal(alwaysWaits('local.reminder-draft'), false);
});

test('the daily amount limit: nothing that touches money runs by default, and the day’s total stays within the limit', async t => {
  const engine = await fixture(t);
  await engine.request('trust.update', { autonomy: true });
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const withAmount = async (n: number, amountMinor: unknown) => {
    const action = await engine.request('actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: `inv-${n}`, text: 'Synthetic reminder', amountMinor }, idempotencyKey: `synthetic-amount-${n}` });
    await (engine as any).store().update((state: any) => { lane(state).reminders.push({ customerId: `cust-${n}`, invoiceId: `inv-${n}`, day: '2026-10-05', actionId: action.id, jobId: 'synthetic-job', key: action.idempotencyKey, ownerId: action.createdBy }); });
    return action;
  };
  const status = async (id: string) => (await engine.request('actions.list')).find((a: any) => a.id === id).status;
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true });
  const first = await withAmount(61, '5000');
  await engine.tick();
  assert.equal(await status(first.id), 'prepared', 'the default limit is zero: money never runs on its own');
  await refused(engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyAmountMinor: '10.5' }), 'INVALID_AUTONOMY');
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyAmountMinor: '10000' });
  await engine.tick();
  assert.equal(await status(first.id), 'verified');
  const second = await withAmount(62, '6000'); const unreadable = await withAmount(63, 'lots');
  await engine.tick();
  assert.equal(await status(second.id), 'prepared', '5000 + 6000 is over the 10000 limit');
  assert.equal(await status(unreadable.id), 'prepared', 'an unreadable amount never runs on its own');
  const view = await engine.request('jobsx.autonomy');
  const row = view.kinds.find((k: any) => k.kind === KIND);
  assert.equal(row.dailyAmountMinor, '10000'); assert.equal(row.amountUsedTodayMinor, '5000');
});

test('an overlapping claim never erases the record of a run, and the claim reads the live switch and limits', async t => {
  const engine = await fixture(t);
  await engine.request('trust.update', { autonomy: true });
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true, dailyAmountMinor: '10000' });
  const first = await prepare(engine, 71);
  // Another tick already claimed this action: this tick must not claim it again, nor remove that record.
  await (engine as any).store().update((state: any) => { lane(state).autonomy.runs.push({ kind: KIND, actionId: first.id, at: new Date().toISOString(), claim: 'other-tick' }); });
  await engine.tick();
  const runs = () => (engine as any).store().read().extensions['jobs-ext'].autonomy.runs.filter((r: any) => r.actionId === first.id);
  assert.equal(runs().length, 1); assert.equal(runs()[0].claim, 'other-tick');
  // The kind switched off between the snapshot and the claim: nothing more runs.
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: false });
  const second = await prepare(engine, 72);
  await engine.tick();
  assert.equal((await engine.request('actions.list')).find((a: any) => a.id === second.id).status, 'prepared');
  // An omitted amount keeps the limit; a preset keeps it too.
  await engine.request('jobsx.setAutonomy', { kind: KIND, on: true });
  assert.equal((await engine.request('jobsx.autonomy')).kinds.find((k: any) => k.kind === KIND).dailyAmountMinor, '10000');
  await engine.request('jobsx.autonomyPreset', { preset: 'all-but-always-waits' });
  assert.equal((await engine.request('jobsx.autonomy')).kinds.find((k: any) => k.kind === KIND).dailyAmountMinor, '10000');
});

test('money under any other name or depth is unknown, so it never runs on its own', async () => {
  const { actionAmount } = await import('../runtime/jobs-ext/autonomy.ts');
  assert.equal(actionAmount({ payload: { invoiceId: 'i', text: 't' } }), 0n);
  assert.equal(actionAmount({ payload: { amountMinor: '500', payload: { amountMinor: '250' } } }), 750n);
  for (const payload of [{ amount: '5' }, { total: 1 }, { lines: [{ amountMinor: '5', price: '1' }] }, { a: { b: { value: 1 } } }, { amountMinor: 5 }, { amountMinor: '-5' }])
    assert.equal(actionAmount({ payload }), null, JSON.stringify(payload));
});
