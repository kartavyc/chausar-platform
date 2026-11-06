// Ink final pass, the AI-native CA firm as engine methods: venture.ca.get, venture.ca.setOfRecord,
// venture.ca.recordSignoff and venture.ca.confirmRates, and the sign-off request a ready delivery run for a regulated
// offer makes on its own (playbooks/ca-firm/delivery-signoff.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { CaFirmView, CaRequestView, QueueList } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { RATE_TABLES } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { requestCaSignoff, sendToCa } from '../runtime/venture/playbooks/ca-firm/signoff.ts';
import { caOfferOf, requestSignoffForRun } from '../runtime/venture/playbooks/ca-firm/delivery-signoff.ts';
import { runView } from '../runtime/venture/delivery/runs.ts';
import { call, code, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const CA = { name: 'CA Asha Rao', membershipNo: '123456' };
const get = (env: Env) => call<CaFirmView>(env, 'venture.ca.get', {});
const setCa = (env: Env, body: Record<string, unknown> = CA) => call<CaFirmView>(env, 'venture.ca.setOfRecord', body);
const papers = (deliveryId?: string) => ({
  subjectKind: 'gst-working', title: 'GST working for October 2025', clientName: 'Cafe Aroma Demo', workingDigest: digest({ papers: deliveryId ?? 'none' }),
  receiptIds: ['ca_0123456789abcdef01234567'], ...(deliveryId ? { deliveryId } : {}),
});

test('venture.ca.get: no CA of record, every rate table waiting, no papers; versions as text with their citations', async () => {
  const env = await setup();
  const view = await get(env);
  assert.equal(view.ca, null);
  assert.deepEqual(view.requests, []);
  assert.deepEqual(view.pendingRates.map(rate => `${rate.tableId}@${rate.version}`), RATE_TABLES.map(table => `${table.id}@${table.version}`));
  const gst = view.pendingRates.find(rate => rate.tableId === 'in-gst-rates' && rate.version === '2')!;
  assert.equal(gst.validFrom, '2025-09-22');
  assert.equal(gst.validTo, null);
  assert.ok(gst.citations.length > 0 && gst.citations.every(line => typeof line === 'string' && line.length > 3));
  await assert.rejects(call(env, 'venture.ca.get', { extra: true }), code('INVALID_VENTURE_REQUEST'));
});

test('venture.ca.setOfRecord: inside the app only, six digits, and the newest CA is the one shown', async () => {
  const env = await setup();
  await assert.rejects(call(env, 'venture.ca.setOfRecord', CA, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(setCa(env, { name: 'CA Asha Rao', membershipNo: '12-3456' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(setCa(env, { name: 'CA Asha Rao' }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual((await setCa(env)).ca, CA);
  assert.deepEqual((await setCa(env, { name: 'CA Vikram Shah', membershipNo: ' 654321 ' })).ca, { name: 'CA Vikram Shah', membershipNo: '654321' });
});

test('venture.ca.confirmRates: the CA of record types their number; a table id confirms every waiting version of it', async () => {
  const env = await setup();
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: '123456' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: '123456' }), code('CA_OF_RECORD_REQUIRED'));
  await setCa(env);
  // A wrong number writes nothing: no rate table is sent to the CA either.
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: '654321' }), code('CA_MEMBERSHIP_MISMATCH'));
  assert.deepEqual(listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'sent-to-ca'), []);
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: ['in-no-such-table'], membershipNo: '123456' }), code('SIGNOFF_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: [], membershipNo: '123456' }), code('INVALID_VENTURE_REQUEST'));

  // Version 1 of the FY 2025-26 TDS table is history only (its no-PAN rule was wrong): nothing confirms it now.
  await assert.rejects(call(env, 'venture.ca.confirmRates', { tableIds: ['in-tds-fy-2025-26@1'], membershipNo: '123456' }), code('SIGNOFF_NOT_FOUND'));
  const view = await call<CaFirmView>(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates', 'in-tds-fy-2025-26@2'], membershipNo: '123 456' });
  assert.deepEqual(view.pendingRates.map(rate => rate.tableId).sort(), ['in-income-tax-ay-2026-27', 'in-income-tax-ay-2027-28', 'in-income-tax-interest-ay-2026-27', 'in-tds-fy-2026-27'].sort());
  const confirmed = listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'rate-confirmation');
  assert.deepEqual(confirmed.map(item => item.entry === 'rate-confirmation' ? [item.tableId, item.tableVersion, item.caName, item.membershipNumber] : null),
    [['in-gst-rates', 1, 'CA Asha Rao', '123456'], ['in-gst-rates', 2, 'CA Asha Rao', '123456'], ['in-tds-fy-2025-26', 2, 'CA Asha Rao', '123456']]);
  // Confirmed already: nothing more is written, and Today has no rate rows for them.
  const again = await call<CaFirmView>(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: '123456' });
  assert.deepEqual(again.pendingRates, view.pendingRates);
  assert.equal(listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'rate-confirmation').length, 3);
  const queue = await call<QueueList>(env, 'venture.queue.list', {});
  assert.ok(!queue.rows.some(row => row.id.startsWith('ca-rates:sign')), 'nothing confirmed waits for the CA');
});

test('venture.ca.recordSignoff: papers from a run show once sent, the CA signs with their own number, the list says signed', async () => {
  const env = await setup();
  await setCa(env);
  const outside = await requestCaSignoff(env.deps, owner, papers());
  const asked = await requestCaSignoff(env.deps, owner, papers('delivery_run_one'));
  // Asked again for the same run: the first request comes back, so a run asks its CA once.
  assert.equal((await requestCaSignoff(env.deps, owner, papers('delivery_run_one'))).id, asked.id);
  // Not sent yet: Today has it as Send to CA, the CA place does not, and it cannot be signed.
  assert.deepEqual((await get(env)).requests, []);
  await assert.rejects(call(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: '123456' }), code('SIGNOFF_NOT_FOUND'));

  env.advance(60_000);
  await sendToCa(env.deps, owner, [asked.id, outside.id]);
  const sent = (await get(env)).requests;
  assert.deepEqual(sent.map(item => [item.id, item.deliveryId, item.title, item.state]), [[asked.id, 'delivery_run_one', 'GST working for October 2025', 'sent']]);

  await assert.rejects(call(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: '123456' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: '654321' }), code('CA_MEMBERSHIP_MISMATCH'));
  env.advance(60_000);
  const { request } = await call<{ request: CaRequestView }>(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: '123456', note: 'Checked against GSTR-2B.' });
  assert.deepEqual([request.id, request.deliveryId, request.state, request.at], [asked.id, 'delivery_run_one', 'signed', env.now()]);
  const [signed] = listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'signoff');
  assert.ok(signed?.entry === 'signoff' && signed.note === 'Checked against GSTR-2B.' && signed.membershipNumber === '123456');
  assert.deepEqual((await get(env)).requests.map(item => item.state), ['signed']);
  await assert.rejects(call(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: '123456' }), code('SIGNOFF_NOT_FOUND'));
});

// ---------------------------------------------------------------------------
// A ready delivery run for a regulated offer asks the CA of record on its own
// ---------------------------------------------------------------------------

async function caFirm(env: Env, offerName: string) {
  await ventureAction(env.deps, owner, 'admin', 'seed.idea', tx => { tx.touch({ idea: 'An AI-native CA firm for GST filing and income tax returns in Pune.' }); });
  const plan = await seedBlueprint(env);
  await ventureAction(env.deps, owner, 'admin', 'seed.offer', tx => {
    const stored = tx.find('venture-blueprint', plan.id)!;
    tx.replace({ ...stored, offers: stored.offers.map(offer => offer.id === 'offer_1' ? { ...offer, name: { ...offer.name, value: offerName } } : offer) });
  });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  return order;
}

const viewOf = (env: Env, id: string) => runView(listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === id)!, listRecords(env.store.read(), 'venture-record')[0], Date.parse(env.now()));

test('caOfferOf: the playbook offer an order is, from its own words; the CA\'s own work wins a tie', () => {
  const of = (name: string, description = '') => caOfferOf({ name, description })?.id ?? null;
  assert.equal(of('GST working papers'), 'gst-working');
  assert.equal(of('Monthly GSTR filing help'), 'gst-working');
  assert.equal(of('TDS working'), 'tds-working');
  assert.equal(of('Income tax return preparation'), 'itr-salaried');
  assert.equal(of('ITR for small business'), 'itr-small-business');
  assert.equal(of('Notice replies'), 'notice-replies');
  assert.equal(of('Monthly books'), 'monthly-books');
  assert.equal(of('Logo design'), null);
});

test('a ready agent draft for a regulated offer asks the CA once and lands on Today as Send to CA', async () => {
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  const run = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'model', renderedText: 'Summary\nGST working for October.', playbookHash: 'a'.repeat(64) });
  // No CA of record yet: nothing is asked, and the run stands.
  assert.equal(await requestSignoffForRun(env.deps, owner, viewOf(env, run.id)), null);
  await setCa(env);
  const id = await requestSignoffForRun(env.deps, owner, viewOf(env, run.id));
  assert.ok(id);
  assert.equal(await requestSignoffForRun(env.deps, owner, viewOf(env, run.id)), id, 'asked once per run');
  const [request] = listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'signoff-request');
  assert.ok(request?.entry === 'signoff-request');
  assert.deepEqual([request.subjectKind, request.title, request.clientName, request.deliveryId, request.receiptIds, request.playbookHash],
    ['gst-working', 'GST working papers for Cafe Aroma Demo', 'Cafe Aroma Demo', run.id, [order.priceReceiptId], 'a'.repeat(64)]);
  const queue = await call<QueueList>(env, 'venture.queue.list', {});
  assert.ok(queue.rows.some(row => row.id === `ca-signoff:${id}:send` && row.kind === 'signoff'));
});

test('no CA request for unregulated work, practice drafts, failed checks, template outlines or another playbook', async () => {
  const books = await setup();
  const bookOrder = await caFirm(books, 'Monthly books');
  await setCa(books);
  const bookRun = await seedRun(books, bookOrder, { status: 'ready-for-review', servedBy: 'model', renderedText: 'Summary' });
  assert.equal(await requestSignoffForRun(books.deps, owner, viewOf(books, bookRun.id)), null, 'monthly books is not regulated');

  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  await setCa(env);
  const template = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'template', renderedText: 'Outline' });
  const failed = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'model', renderedText: 'Draft', checks: [{ check: 'house-style', passed: false, detail: 'An em dash.' }] });
  const practice = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'model', renderedText: 'Draft', practice: true });
  const waiting = await seedRun(env, order, { status: 'waiting-for-you', servedBy: 'model' });
  for (const run of [template, failed, practice, waiting]) assert.equal(await requestSignoffForRun(env.deps, owner, viewOf(env, run.id)), null, run.servedBy);
  assert.deepEqual(listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'signoff-request'), []);

  const plain = await setup();
  const plan = await seedBlueprint(plain);
  const { order: plainOrder } = await seedOrder(plain, plan);
  await setStage(plain, 'approve-each');
  await setCa(plain);
  const plainRun = await seedRun(plain, plainOrder, { status: 'ready-for-review', servedBy: 'model', renderedText: 'Draft' });
  assert.equal(await requestSignoffForRun(plain.deps, owner, viewOf(plain, plainRun.id)), null, 'a bookkeeping idea is not the CA firm playbook');
});

test('delivery approve asks the CA after a draft is ready, and a failure there never fails the run', async () => {
  const source = await readFile(new URL('../runtime/venture/delivery/runs.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(view\.status === 'ready-for-review'\) \{\s*await import\('\.\.\/playbooks\/ca-firm\/delivery-signoff\.ts'\)\.then\(module => module\.requestSignoffForRun\(deps, ctx, view\)\)\.catch\(\(\) => null\);/);
});
