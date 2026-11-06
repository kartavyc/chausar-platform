// Wave 6, package 6E4 (DECISIONS D2): the document desk. The tender desk generalised into document and report
// services (handbooks, SOPs, project reports, estimates, thesis edits, technical writing): the owner sets the outline,
// the client files and a figures table computed by code with a receipt; agents draft from the files with no amounts of
// their own; the owner approves the exact document and exports the pack. The tender desk keeps its own behaviour on
// the shared parts (kit/documents/money.ts and pack.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, deliver, draft, owner } from './fixtures/venture/kit-business.ts';
import { PLAYBOOK_REGISTRY, validateRegistry } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { deskHandler } from '../runtime/venture/playbooks/desks.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import { computeFigures, lineAmount, unreceiptedAmounts } from '../runtime/venture/playbooks/document-desk/core.ts';
import { sourceMoneyReceipts } from '../runtime/venture/playbooks/kit/documents/money.ts';
import { tenderMoneyReceipts } from '../runtime/venture/playbooks/tender-desk/money.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { net, personNamed } from './venture-network-env.ts';
import { deskContext } from '../runtime/venture/agent-runtime/desk-context.ts';

const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
const IDEA = 'A document desk for HR handbooks and SOPs in Pune';
const FIGURES = { currency: 'INR', lines: [{ label: 'Printing', quantity: '2.5', unit: '333.33' }, { label: 'Binding', quantity: '4', unit: '150' }] };

test('6E4 the document desk is registered, defined and has a desk; the tender desk stays', () => {
  validateRegistry();
  for (const id of ['document-desk', 'tender-desk']) assert.ok(PLAYBOOK_REGISTRY.some(entry => entry.id === id), id);
  const definition = PLAYBOOK_DEFINITIONS.find(item => item.registration.id === 'document-desk');
  assert.ok(definition);
  assert.deepEqual(definition.offers.map(offer => offer.id), ['handbook-sop', 'project-report', 'estimate', 'thesis-edit', 'technical-writing']);
  assert.ok(deskHandler('document-desk', 'document'));
  assert.ok(deskHandler('tender-desk', 'bid'));
  const baseline = runKitBaseline(definition);
  assert.equal(baseline.ok, true, baseline.detail);
  assert.equal(baseline.passed, baseline.of);
});

test('6E4 the tender desk reads amounts through the shared extractor with its own receipt names', () => {
  const documents = [{ id: 'quote', text: 'Our quote is INR 9,000.' }];
  const tender = tenderMoneyReceipts('We charge INR 9,000 and INR 1,200.', documents);
  assert.deepEqual(tender, sourceMoneyReceipts('We charge INR 9,000 and INR 1,200.', documents, 'tender_money_'));
  assert.equal(tender.receipts.length, 1);
  assert.match(tender.receipts[0]!.id, /^tender_money_[a-f0-9]{64}$/);
  assert.deepEqual(tender.unmatched, ['INR 1,200']);
});

test('6E4 code computes every figure with BigInt, rounding half up, and names its receipt', () => {
  assert.equal(lineAmount('2.5', '33333'), '83333');
  assert.equal(lineAmount('0.001', '499'), '0');
  assert.equal(lineAmount('1.125', '4'), '5');
  const figures = computeFigures(FIGURES)!;
  assert.deepEqual(figures.lines.map(line => line.lineMinor), ['83333', '60000']);
  assert.equal(figures.totalMinor, '143333');
  assert.match(figures.receiptId, /^document_figures_[a-f0-9]{64}$/);
  assert.equal(computeFigures(FIGURES)!.receiptId, figures.receiptId, 'the same figures give the same receipt');
  assert.equal(computeFigures({ currency: 'INR', lines: [] }), null);
  assert.throws(() => computeFigures({ currency: 'INR', lines: [{ label: 'Bad', quantity: '1', unit: '10.005' }] }), code('DOCUMENT_INPUT_INVALID', /decimal places/));
  assert.throws(() => computeFigures({ currency: 'INR', lines: [{ label: 'Bad', quantity: '1.2345', unit: '10' }] }), code('DOCUMENT_INPUT_INVALID'));
  assert.deepEqual(unreceiptedAmounts('The total is INR 1,433.33 and printing INR 833.33.', figures), []);
  assert.deepEqual(unreceiptedAmounts('The total is INR 1,500.', figures), ['INR 1,500']);
});

async function documentOrder() {
  const env = await kitBusiness(undefined, { idea: IDEA });
  const offer = env.offers.find(item => item.playbookOffer === 'handbook-sop')!;
  assert.ok(offer, 'the plan keeps the handbook offer');
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'An employee handbook from our policies.', intake: { fields: { scope: 'An employee handbook.', deliverable: 'One handbook.' } } });
  const file = await env.call('venture.files.add', { orderId: order.id, name: 'policy.csv', contentBase64: Buffer.from('policy\nStaff work six days a week.').toString('base64') });
  const handler = deskHandler('document-desk', 'document')!;
  const base = { playbook: 'document-desk', kind: 'document', id: order.id };
  const get = () => handler.get!(env.deps, owner, base as never) as Promise<any>;
  const act = async (action: string, payload: unknown, withDigest = true) => handler.act!(env.deps, owner, { ...base, action, payload, ...(withDigest ? { digest: (await get()).digest } : {}) } as never) as Promise<any>;
  return { env, order, file, get, act };
}

test('6E4 the full document path: brief, AI draft, take, approve, export; a changed file makes it stale', async () => {
  const { env, order, file, get, act } = await documentOrder();
  await assert.rejects(act('create', { docType: 'handbook', title: 'Staff handbook', sourceFileIds: ['upload_nope'] }, false), code('DOCUMENT_SOURCE_REQUIRED'));
  await act('create', { docType: 'handbook', title: 'Staff handbook', sourceFileIds: [file.id] }, false);
  let view = await get();
  assert.deepEqual(view.item.sections.map((row: any) => row.heading), ['Purpose and scope', 'Working hours and leave', 'Conduct', 'Pay and benefits', 'Raising a concern', 'Acknowledgement']);
  await act('outline', { sections: [{ heading: 'Purpose and scope', brief: 'Why the handbook exists.' }, { heading: 'Working hours', brief: 'From the policy file.' }, { heading: 'Printing costs', brief: 'From the figures table.' }] });
  await act('figures', FIGURES);
  view = await get();
  assert.equal(view.item.figures.totalMinor, '143333');
  assert.deepEqual(view.item.figureWords, ['Printing: 2.5 at ₹333.33 is ₹833.33', 'Binding: 4 at ₹150 is ₹600', 'Total: ₹1,433.33', 'Receipt ' + view.item.figures.receiptId]);
  await assert.rejects(act('section', { sectionId: 'section-3', text: 'Printing costs INR 2,000.' }), code('DOCUMENT_FIGURE_UNRECEIPTED', /INR 2,000/));
  await assert.rejects(act('approve', {}), code('DOCUMENT_BRIEF_REQUIRED'));

  // AI work waits for the approved brief.
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const early = await deliver(env, order.id, draft('Staff handbook', { Document: ['Working hours', 'Staff work six days a week.'] })).catch((error: any) => error);
  assert.equal(early?.status, 'failed');
  const state = env.store.read(), stored = state.conversations.find((row: any) => row.id === early.id) as any, storedOrder = state.conversations.find((row: any) => row.id === order.id) as any;
  assert.throws(() => deskContext(state, stored, storedOrder, 'document-desk', 'handbook-sop'), code('DOCUMENT_BRIEF_REQUIRED'));
  assert.equal(env.models.drafts.length, 1, 'the refused run never read its draft');
  env.models.drafts.length = 0;

  await act('approve-brief', {});
  assert.equal((await get()).item.briefApproved, true);
  const run = await deliver(env, order.id, draft('Staff handbook', { Document: ['Purpose and scope', 'This handbook sets out how the team works.', 'Working hours', 'Staff work six days a week.'] }));
  assert.equal(run.status, 'ready-for-review', JSON.stringify({pb:run.playbookChecks,reads:env.models.agentReads.filter((r:any)=>r.name==='tool_error')}));
  assert.ok(run.playbookChecks?.some((item: any) => item.check === 'document-figures' && item.outcome === 'pass'));
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  await act('take-draft', { runId: run.id });
  view = await get();
  assert.equal(view.item.sections[1].text, 'Staff work six days a week.');
  assert.equal(view.item.sections[1].authoredBy, 'agent');
  await assert.rejects(act('approve', {}), code('DOCUMENT_SECTION_REQUIRED', /Printing costs/));
  await act('section', { sectionId: 'section-3', text: 'Printing costs come to INR 1,433.33 in total.' });
  await act('approve', {});
  assert.equal((await get()).item.approved, true);
  const out = await act('export', {});
  assert.deepEqual(out.result.files.map((row: any) => row.name), ['document.docx', 'figures.xlsx', 'figures.csv', 'figures-receipt.json']);
  assert.equal(out.result.sent, false);
  const docx = Buffer.from(out.result.files[0].contentBase64, 'base64');
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  assert.match(Buffer.from(out.result.files[3].contentBase64, 'base64').toString(), /document_figures_/);

  // A section edit clears the approval; a changed client file makes the document stale.
  await act('section', { sectionId: 'section-1', text: 'This handbook sets out how the whole team works.' });
  assert.equal((await get()).item.approved, false);
  await ventureAction(env.deps, owner, 'prepare', 'test.change-file', tx => { const row = tx.find('venture-upload', file.id)!; tx.replace({ ...row, digest: 'f'.repeat(64) }); });
  assert.equal((await get()).item.stale, true);
  await assert.rejects(act('approve', {}), code('DERIVED_STALE'));
  await act('sources', { sourceFileIds: [file.id] });
  assert.equal((await get()).item.stale, false);
  assert.equal((await get()).item.briefApproved, false, 'new sources need a new brief approval');
});

test('6E4 a draft with an amount of its own fails the document-figures check', async () => {
  const { env, order, file, act } = await documentOrder();
  await act('create', { docType: 'estimate', title: 'Shop fit-out estimate', sourceFileIds: [file.id] }, false);
  await act('approve-brief', {});
  const run = await deliver(env, order.id, draft('Shop fit-out estimate', { Document: ['Scope of work', 'The work costs INR 50,000 in all.'] })).catch((error: any) => error);
  const failed = run?.code ? run.code : run.playbookChecks?.find((item: any) => item.check === 'document-figures')?.outcome ?? run.status;
  assert.notEqual(failed, 'pass');
  assert.notEqual(run?.status, 'accepted');
});

test('6E4 Forget removes the client\'s document', async () => {
  const { env, file, act } = await documentOrder();
  await act('create', { docType: 'sop', title: 'Cleaning procedure', sourceFileIds: [file.id] }, false);
  await net(env as any, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: 'Name,E-mail 1 - Value\nAsha Rao,asha@example.com' });
  const person = personNamed(env as any, 'Asha Rao');
  await ventureAction(env.deps, owner, 'prepare', 'test.link', tx => { tx.replace({ ...tx.find('venture-person', person.id)!, clientId: env.client.id }); });
  await net(env as any, 'venture.network.forget', { id: person.id });
  assert.equal(listRecords(env.store.read(), 'venture-document').length, 0);
});
