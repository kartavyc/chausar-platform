// W1 package 1A, the CA firm's gates (catalogue rows H1 and H2). A regulated draft (a GST or TDS working, an income
// tax return, a notice reply) is accepted or shared only once the CA of record has signed off that exact draft; books
// work needs no sign-off. A GST, TDS or income tax working whose tax figure is on no calculator receipt fails its
// checks and cannot be accepted, and the calculator's refusals reach the checks as "do not retry".
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import type { Deliverable, DeliveryRunRecord, DeliveryRunView, OrderRecord, QueueDecision, QueueList, RunSummary } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { deliveryListHandler, deliveryReviewHandler } from '../runtime/venture/delivery/runs.ts';
import { shareCreate } from '../runtime/venture/build/share-links.ts';
import { draftPostGate } from '../runtime/venture/build/posting.ts';
import { requestSignoffForRun } from '../runtime/venture/playbooks/ca-firm/delivery-signoff.ts';
import { papersDigest } from '../runtime/venture/playbooks/ca-firm/signoff-gate.ts';
import { recordCaSignoff, sendToCa, sentTo, signoffRequests } from '../runtime/venture/playbooks/ca-firm/signoff.ts';
import { calculatorRefusal, checkCaDraft, refusalsOf, type CaDraftInput } from '../runtime/venture/playbooks/ca-firm/claims.ts';
import { gstWorking } from '../runtime/venture/playbooks/ca-firm/gst.ts';
import { tdsWorking } from '../runtime/venture/playbooks/ca-firm/tds.ts';
import { computeIncomeTax } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { rateTableFor } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import type { CaReceipt } from '../runtime/venture/playbooks/ca-firm/receipt.ts';
import { runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';
import { call, code, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const CA = { name: 'CA Asha Rao', membershipNo: '123456' };
const R = (rupees: number) => String(BigInt(rupees) * 100n);
const PAPERS: Deliverable = {
  title: 'GST working for October', questionsForClient: [],
  sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'The working papers for October follow.' }] }],
};
const ready = (fields: Partial<DeliveryRunRecord> = {}): Partial<DeliveryRunRecord> => ({
  status: 'ready-for-review', servedBy: 'model', renderedText: 'Summary\nThe working papers for October follow.', deliverable: PAPERS, playbookHash: 'a'.repeat(64), ...fields,
});

/** A CA firm business at approve each, its first offer named as given, and one order for it. */
async function caFirm(env: Env, offerName: string): Promise<OrderRecord> {
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

const review = (env: Env, runId: string, verdict: 'accepted' | 'edited', extra: Record<string, unknown> = {}) =>
  deliveryReviewHandler(env.deps, owner, { runId, verdict, ...extra });
const listed = async (env: Env, runId: string): Promise<DeliveryRunView> => (await deliveryListHandler(env.deps, owner, {})).find(item => item.id === runId)!;
const refused = (pattern: RegExp) => (error: any) => { assert.equal(error?.code, 'CA_SIGNOFF_REQUIRED', error?.message); assert.match(error.message, pattern); return true; };
const requestsFor = (env: Env, runId: string) => signoffRequests(env.store.read(), env.venture.id).filter(item => item.deliveryId === runId);
const summaryOf = async (env: Env, runId: string) => (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', { state: 'all' })).runs.find(item => item.runId === runId)!;

/** The run's papers go to the CA of record, who signs them (or returns them) with their own number. */
async function caDecides(env: Env, runId: string, decision: 'signed' | 'returned' = 'signed'): Promise<string> {
  const requestId = await requestSignoffForRun(env.deps, owner, await listed(env, runId));
  assert.ok(requestId, 'the ready papers went in front of the CA');
  await sendToCa(env.deps, owner, [requestId]);
  if (decision === 'signed') await call(env, 'venture.ca.recordSignoff', { requestId, membershipNo: CA.membershipNo });
  else await recordCaSignoff(env.deps, owner, { requestId, decision: 'returned', note: 'Fix the October totals.' });
  return requestId;
}

// ---------------------------------------------------------------------------
// H1: the CA's sign-off gates Accept and share links
// ---------------------------------------------------------------------------

test('H1: a regulated draft with no CA sign-off cannot be accepted; once the CA signs that draft, it can', async () => {
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  await call(env, 'venture.ca.setOfRecord', CA);
  const run = await seedRun(env, order, ready());
  await assert.rejects(review(env, run.id, 'accepted'), refused(/sign/));
  // The list says so before the owner clicks: Accept is shut, with the reason.
  const before = await listed(env, run.id);
  assert.deepEqual([before.canAccept, before.status], [false, 'ready-for-review']);
  assert.match(before.acceptBlocked!, /not gone to your CA/);

  await caDecides(env, run.id);
  const after = await listed(env, run.id);
  assert.equal(after.canAccept, true, after.acceptBlocked ?? '');
  assert.equal((await review(env, run.id, 'accepted')).status, 'accepted');
});

test('H1: a sign-off covers only the papers it was given: returned papers, or a changed draft, keep Accept shut', async () => {
  const env = await setup();
  const order = await caFirm(env, 'TDS working');
  await call(env, 'venture.ca.setOfRecord', CA);
  const returned = await seedRun(env, order, ready());
  await caDecides(env, returned.id, 'returned');
  await assert.rejects(review(env, returned.id, 'accepted'), refused(/returned/));

  const changed = await seedRun(env, order, ready());
  await caDecides(env, changed.id);
  await ventureAction(env.deps, owner, 'admin', 'seed.change', tx => {
    const stored = tx.find('venture-delivery-run', changed.id)!;
    tx.replace({ ...stored, renderedText: 'Summary\nOther papers than the ones the CA signed.' });
  });
  await assert.rejects(review(env, changed.id, 'accepted'), refused(/different/));
});

test('H1: books work needs no sign-off; without a CA of record, or as an outline, regulated papers stay shut', async () => {
  const books = await setup();
  const bookOrder = await caFirm(books, 'Monthly books');
  const bookRun = await seedRun(books, bookOrder, ready());
  assert.equal((await listed(books, bookRun.id)).canAccept, true);
  assert.equal((await review(books, bookRun.id, 'accepted')).status, 'accepted');

  const plain = await setup();
  const { order: plainOrder } = await seedOrder(plain, await seedBlueprint(plain));
  await setStage(plain, 'approve-each');
  const plainRun = await seedRun(plain, plainOrder, ready());
  assert.equal((await review(plain, plainRun.id, 'accepted')).status, 'accepted', 'a business that is not a CA firm is unaffected');

  const env = await setup();
  const order = await caFirm(env, 'Income tax return preparation');
  const noCa = await seedRun(env, order, ready());
  await assert.rejects(review(env, noCa.id, 'accepted'), refused(/CA of record/));
  await call(env, 'venture.ca.setOfRecord', CA);
  const outline = await seedRun(env, order, ready({ servedBy: 'template' }));
  await assert.rejects(review(env, outline.id, 'accepted'), refused(/outline/));
});

test('H1: a share link for regulated papers waits for the same sign-off; an edit of signed papers is not shared', async () => {
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  await call(env, 'venture.ca.setOfRecord', CA);
  const run = await seedRun(env, order, ready());
  await assert.rejects(shareCreate(env.deps, owner, { deliveryId: run.id }), refused(/sign/));
  await caDecides(env, run.id);
  const link = await shareCreate(env.deps, owner, { deliveryId: run.id });
  assert.ok(link.id);

  const edited = await seedRun(env, order, ready());
  await caDecides(env, edited.id);
  assert.equal((await review(env, edited.id, 'edited', { editedText: 'My own words for the client.' })).status, 'edited');
  await assert.rejects(shareCreate(env.deps, owner, { deliveryId: edited.id }), refused(/edit/));

  // Books work shares as before.
  const books = await setup();
  const bookRun = await seedRun(books, await caFirm(books, 'Monthly books'), ready());
  assert.ok((await shareCreate(books.deps, owner, { deliveryId: bookRun.id })).id);
});

test('H1: an edit of regulated papers is new papers: it goes to the CA, and nothing carries it until the CA signs that edit', async () => {
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  await call(env, 'venture.ca.setOfRecord', CA);
  const run = await seedRun(env, order, ready());
  // Unsigned papers may be edited; the edit goes in front of the CA at once, under its own digest.
  const editedText = 'LinkedIn: Our October GST papers are ready for your CA.';
  assert.equal((await review(env, run.id, 'edited', { editedText })).status, 'edited');
  const [asked] = requestsFor(env, run.id);
  assert.ok(asked, 'the edit was put in front of the CA');
  assert.equal(asked.workingDigest, papersDigest({ ...run, status: 'edited', editedText }));
  // Not shared, not posted, and the run never tells the owner to send it while the edit waits.
  await assert.rejects(shareCreate(env.deps, owner, { deliveryId: run.id }), refused(/edit/));
  const posting = () => draftPostGate(env.store.read(), { draftId: run.id, connectorId: 'linkedin' }).reasons.map(item => item.code);
  assert.ok(posting().includes('CA_SIGNOFF_REQUIRED'));
  const waiting = await summaryOf(env, run.id);
  assert.doesNotMatch(waiting.result ?? '', /You send your version/);
  assert.match(waiting.result ?? '', /CA/);

  // Once the CA signs the edit itself, it may go out.
  await sendToCa(env.deps, owner, [asked.id]);
  await call(env, 'venture.ca.recordSignoff', { requestId: asked.id, membershipNo: CA.membershipNo });
  assert.ok(!posting().includes('CA_SIGNOFF_REQUIRED'));
  assert.equal((await summaryOf(env, run.id)).result, 'You edited the draft. You send your version.');
  assert.ok((await shareCreate(env.deps, owner, { deliveryId: run.id })).id);
});

test('H1: tax audit papers are regulated too, signed off as audit papers', async () => {
  const env = await setup();
  const order = await caFirm(env, 'Tax audit support');
  await call(env, 'venture.ca.setOfRecord', CA);
  const run = await seedRun(env, order, ready());
  await assert.rejects(review(env, run.id, 'accepted'), refused(/sign/));
  await assert.rejects(shareCreate(env.deps, owner, { deliveryId: run.id }), refused(/sign/));
  const requestId = await caDecides(env, run.id);
  assert.equal(requestsFor(env, run.id).find(item => item.id === requestId)?.subjectKind, 'audit-papers');
  assert.equal((await review(env, run.id, 'accepted')).status, 'accepted');
});

test('H1: naming the CA puts waiting papers in front of them, and a held draft row sends its papers to the CA', async () => {
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  const early = await seedRun(env, order, ready());
  assert.deepEqual(requestsFor(env, early.id), []);
  await call(env, 'venture.ca.setOfRecord', CA);
  assert.equal(requestsFor(env, early.id).length, 1, 'naming the CA asked for the sign-off the ready papers were missing');

  // Papers that became ready with no request: their Today row offers Send to CA, which asks and sends in one click.
  const later = await seedRun(env, order, ready());
  const row = (await call<QueueList>(env, 'venture.queue.list', {})).rows.find(item => item.id.startsWith(`run:${later.id}`))!;
  assert.ok(row.actions.some(item => item.id === 'send-to-ca'), JSON.stringify(row.actions));
  const decided = await call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'send-to-ca', viewed: true });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  const [request] = requestsFor(env, later.id);
  assert.ok(request && sentTo(env.store.read(), env.venture.id, request.id), 'the request was made and sent to the CA');
  // Sent and not yet signed has its own words.
  assert.match((await listed(env, later.id)).acceptBlocked!, /with your CA/);
  const after = (await call<QueueList>(env, 'venture.queue.list', {})).rows.find(item => item.id.startsWith(`run:${later.id}`));
  assert.ok(!after?.actions.some(item => item.id === 'send-to-ca'), 'nothing more to send');
});

// ---------------------------------------------------------------------------
// H2: the tax figure comes from a calculator receipt; refusals say do not retry
// ---------------------------------------------------------------------------

const GST = gstWorking({ gstin: '27AAACL1234F1ZZ', period: '2025-10', inward: [], outward: [
  { id: 'o1', invoiceNo: 'INV-101', date: '2025-10-03', counterpartyGstin: '27AAAFS1234K1ZB', placeOfSupply: '27', hsnSac: '998222', taxableMinor: R(1_00_000), rateBps: '1800' },
] });
/** A price receipt read as a receipt: its figures, but no calculator engine. */
const PRICE = { id: 'price_1', figures: [{ key: 'tax', label: 'GST total', minor: '44982', display: 'INR 449.82' }], working: null, tables: [] } as unknown as CaReceipt;
const taxCheck = (input: CaDraftInput) => checkCaDraft(input).findings.find(item => item.check === 'tax-figure-receipted')!;

test('H2: a GST working draft needs its tax figure from a calculator receipt', () => {
  const none = taxCheck({ draft: 'The output tax is worked by the calculator by rate and by head.', receipts: [], offer: 'gst-working' });
  assert.equal(none.passed, false, 'a GST working with no GST figure fails');
  assert.match(none.detail, /no GST figure/);
  const good = taxCheck({ draft: 'Output CGST for October comes to ₹9,000 and output SGST to ₹9,000, at 18%.\nGST to pay in cash: ₹18,000.', receipts: [GST], offer: 'gst-working' });
  assert.equal(good.passed, true, good.detail);
  // The taxable value is on the receipt, but it is not the tax: a working must quote a tax or total figure.
  const base = taxCheck({ draft: 'Taxable sales for October come to ₹1,00,000.', receipts: [GST], offer: 'gst-working' });
  assert.equal(base.passed, false, 'the taxable value alone is not the GST figure');
  assert.match(base.detail, /no GST figure/);
  // A figure on a price receipt is not the calculator's working.
  const fromPrice = taxCheck({ draft: 'GST to pay: ₹449.82.', receipts: [GST, PRICE], offer: 'gst-working' });
  assert.equal(fromPrice.passed, false);
  assert.match(fromPrice.detail, /449\.82/);
  // A typed tax figure beside a receipted one still fails.
  const mixed = taxCheck({ draft: 'Output CGST comes to ₹9,000.\nIGST comes to ₹1,200.', receipts: [GST], offer: 'gst-working' });
  assert.equal(mixed.passed, false);
  assert.match(mixed.detail, /1,200/);
  // Books work and a draft with no offer have no tax figure to check.
  assert.equal(taxCheck({ draft: 'Your month ties to the statement.', receipts: [], offer: 'monthly-books' }).passed, true);
  assert.equal(taxCheck({ draft: 'Ready for review.', receipts: [] }).passed, true);
});

test('H2: TDS and income tax workings read their own calculator; tax year names are not figures', () => {
  const tds = tdsWorking({ financialYear: '2026-27', payments: [
    { id: 'c1', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2026-05-10', amountMinor: R(35_000) },
  ] });
  assert.equal(taxCheck({ draft: 'TDS under section 393 for May comes to ₹700.', receipts: [tds], offer: 'tds-working' }).passed, true);
  assert.equal(taxCheck({ draft: 'TDS for May comes to ₹700.', receipts: [GST], offer: 'tds-working' }).passed, false, 'a GST receipt is not the TDS working');
  const tax = computeIncomeTax({ assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', salaryMinor: R(15_00_000) });
  const draft = 'Your income tax for the tax year 2026-27 (AY 2027-28) comes to ₹97,500.';
  const result = checkCaDraft({ draft, receipts: [tax], offer: 'itr-salaried' });
  for (const id of ['tax-figure-receipted', 'figures-from-receipts']) {
    const found = result.findings.find(item => item.check === id)!;
    assert.equal(found.passed, true, `${id}: ${found.detail}`);
  }
});

test('H2: the calculator\'s refusals say do not retry, and a working the calculator refused fails its checks', async () => {
  const cases: [string, () => unknown][] = [
    ['NOT_MODELLED', () => computeIncomeTax({ assessmentYear: '2026-27', regime: 'new', residency: 'resident', ageBand: 'below-60', salaryMinor: R(10_00_000), alsoHas: ['capital-gains'] })],
    ['RATE_TABLE_MISSING', () => rateTableFor('gst-rates', '2024-07-31')],
    ['RATE_TABLE_STALE', () => tdsWorking({ financialYear: '2027-28' as '2026-27', payments: [] })],
  ];
  for (const [expected, make] of cases) {
    let refusal: ReturnType<typeof calculatorRefusal> = null;
    try { make(); } catch (error) { refusal = calculatorRefusal(error); }
    assert.ok(refusal, expected);
    assert.deepEqual([refusal.code, refusal.retry], [expected, false]);
    assert.match(refusal.line, /Do not retry/);
  }
  // A mistake in the inputs, or a table waiting for the CA, is not a refusal: those can be fixed and asked again.
  assert.equal(calculatorRefusal(new ChausarError('TAX_INPUT_INVALID', 'Send the payments as a list.')), null);
  assert.equal(calculatorRefusal(new ChausarError('RATE_UNCONFIRMED', 'Your CA has not confirmed it.')), null);

  // From a run's tool calls, only the calculator's refusals count.
  const notModelled = { ok: false as const, error: { code: 'NOT_MODELLED', name: 'NotModelled', message: 'Capital gains are not modelled here.' } };
  const refusals = refusalsOf([
    { tool: 'tax.income', envelope: notModelled },
    { tool: 'files.read', envelope: { ok: true, result: { total: '1' } } },
    { tool: 'tax.gst', envelope: { ok: false, error: { code: 'TOOL_TIMEOUT', name: 'ToolTimeout', message: 'The tool took too long.' } } },
  ]);
  assert.deepEqual(refusals.map(item => item.code), ['NOT_MODELLED']);
  // A later call to the same engine that worked settles the refusal; a call to another engine does not.
  assert.deepEqual(refusalsOf([{ tool: 'tax.income', envelope: notModelled }, { tool: 'tax.income', envelope: { ok: true, result: { total: '1' } } }]), []);
  assert.equal(refusalsOf([{ tool: 'tax.income', envelope: notModelled }, { tool: 'tax.gst', envelope: { ok: true, result: { total: '1' } } }]).length, 1);
  assert.equal(refusalsOf([{ tool: 'tax.income', envelope: { ok: true, result: { total: '1' } } }, { tool: 'tax.income', envelope: notModelled }]).length, 1, 'a refusal after a success stands');
  const failed = taxCheck({ draft: 'Output CGST comes to ₹9,000.', receipts: [GST], offer: 'gst-working', refusals });
  assert.equal(failed.passed, false);
  assert.match(failed.detail, /Do not retry/);

  // Through the playbook's checks on a run: the check shows and blocks Accept like any failed check.
  const results = await runFlagshipChecks({
    flagship: 'ca-firm', offerKey: 'gst-working', servedBy: 'model', deliverable: PAPERS, request: 'GST working for October.', intake: null,
    files: [], receipts: [], known: [], mode: 'client', today: '2026-10-15', dateOrder: 'day-month-year', refusals,
  });
  const row = results.find(item => item.check === 'tax-figure-receipted')!;
  assert.equal(row.outcome, 'fail');
  assert.match(row.detail, /Do not retry/);
  const env = await setup();
  const order = await caFirm(env, 'GST working papers');
  await call(env, 'venture.ca.setOfRecord', CA);
  const run = await seedRun(env, order, ready({ playbookChecks: results }));
  assert.equal((await listed(env, run.id)).canAccept, false);
  await assert.rejects(review(env, run.id, 'accepted'), code('INVALID_VENTURE_REQUEST'));
});
