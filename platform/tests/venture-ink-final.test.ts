// Ink final pass, engine side: what a Today row is about (venture.queue.view), what clients owe and Money at a glance
// with sum receipts, invoice list totals, dismissing a suggestion, an agent's own posture, the lead blocklist, why a
// paid call was refused, and a rules-judge check nobody settled reading as not checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  AgentView, CheckResult, ClientListRow, EvidenceItem, InvoiceListRow, InvoiceView, LeadView, MoneyOverview, QueueItemView, QueueList,
  SpendRecord, SpendRow, SumReceiptRecord, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import { checkLabel } from '../runtime/venture/views/runs.ts';
import { CLIENT_NAME, call, code, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const run = <T>(table: unknown, env: Env, method: string, payload: unknown = {}, ctx: Context = owner) =>
  ((table as Record<string, Handler>)[method])(env.deps, ctx, payload) as Promise<T>;
const view = (env: Env, payload: Record<string, unknown>) => call<QueueItemView>(env, 'venture.queue.view', payload);
const rows = async (env: Env) => (await call<QueueList>(env, 'venture.queue.list', {})).rows;

/** A business with an accepted plan, one client with one order, and an issued invoice for INR 2,948.82. */
async function withIssuedInvoice(env: Env): Promise<{ invoice: InvoiceView; clientId: string; orderId: string }> {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order, client } = await seedOrder(env, plan);
  const prepared = await run<InvoiceView>(money, env, 'venture.invoice.prepare', { orderId: order.id, dueInDays: 15 });
  const invoice = await run<InvoiceView>(money, env, 'venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest });
  return { invoice, clientId: client.id, orderId: order.id };
}

test('the new methods have their owners, and the writes need the app', () => {
  const owners = {
    'venture.queue.view': 'views', 'venture.team.posture': 'views', 'venture.evidence.dismiss': 'core', 'venture.money.overview': 'money',
    'venture.tax.working': 'money', 'venture.ca.get': 'views', 'venture.ca.setOfRecord': 'views', 'venture.ca.recordSignoff': 'views',
    'venture.ca.confirmRates': 'views', 'venture.leads.block': 'build', 'venture.share.create': 'build', 'venture.share.list': 'build', 'venture.share.revoke': 'build',
  } as const;
  for (const [method, owned] of Object.entries(owners)) assert.equal(METHOD_OWNERS[method as keyof typeof owners], owned, method);
  const writes = ['venture.team.posture', 'venture.evidence.dismiss', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
    'venture.leads.block', 'venture.share.create', 'venture.share.revoke'];
  assert.deepEqual(Object.keys(owners).filter(method => APP_ONLY_METHODS.includes(method as any)), writes);
});

test('queue.view: the plan, an invoice and a draft, each in words to read before deciding', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { status: 'draft', price2: '1500000' });
  const [planRow] = await rows(env);
  assert.equal(planRow.kind, 'plan');
  const planView = await view(env, { id: planRow.id });
  assert.equal(planView.kind, 'plan');
  assert.equal(planView.id, plan.id);
  assert.equal(planView.businessName, 'Ledgerline');
  assert.equal(planView.title, 'Ledger Cafe Books');
  assert.equal(planView.line, 'Monthly books for cafes, drafted with AI help and checked by you.');
  const sell = planView.sections.find(section => section.heading === 'What you sell')!;
  assert.deepEqual(sell.lines, [
    'Monthly books: INR 2,499.00 per month. Bank matching and a short monthly report.',
    'Catch up clean up: INR 15,000.00 per project. A one time tidy up of past months.',
  ]);
  // The same view by the row's viewRef.
  assert.deepEqual(await view(env, { kind: 'plan', id: plan.id }), planView);

  const env2 = await setup();
  const accepted = await seedBlueprint(env2, { price2: '1500000' });
  const { order } = await seedOrder(env2, accepted);
  const prepared = await run<InvoiceView>(money, env2, 'venture.invoice.prepare', { orderId: order.id, dueInDays: 15 });
  const invoiceRow = (await rows(env2)).find(row => row.kind === 'invoice')!;
  const invoiceView = await view(env2, { id: invoiceRow.id });
  assert.equal(invoiceView.kind, 'file');
  assert.equal(invoiceView.id, prepared.invoice.id);
  assert.equal(invoiceView.title, `TAX INVOICE (draft) for ${CLIENT_NAME}`);
  assert.equal(invoiceView.line, 'Due 30 Oct 2026.');
  assert.ok(invoiceView.sections[0].lines.length > 3, 'the document text');
  assert.ok(invoiceView.sections.find(section => section.heading === 'Figures')!.lines.includes('Total: INR 2,948.82'));

  const draftText = '# Your September books\n\n## Summary\nWe matched every bank line.\n\n## Next steps\nSend the two missing bills.';
  const ready = await seedRun(env2, order, { status: 'ready-for-review', renderedText: draftText, checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }] });
  const draftView = await view(env2, { kind: 'draft', id: ready.id });
  assert.equal(draftView.kind, 'draft');
  assert.equal(draftView.agent, 'Bookkeeping agent');
  assert.equal(draftView.line, `For ${CLIENT_NAME}. You send it yourself.`);
  assert.deepEqual(draftView.sections.slice(0, 2), [
    { heading: 'Summary', lines: ['We matched every bank line.'] }, { heading: 'Next steps', lines: ['Send the two missing bills.'] },
  ]);
  assert.deepEqual(draftView.sections.at(-1), { heading: 'Checks', lines: ['1 of 1 checks passed.'] });
});

test('queue.view: a gone row, a row with nothing to read and a bad id are refused in plain words', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const setupRow = (await rows(env)).find(row => row.kind === 'setup')!;
  await assert.rejects(view(env, { id: setupRow.id }), code('QUEUE_ITEM_NOT_FOUND'));
  await assert.rejects(view(env, { id: 'plan:gone:blueprint_missing' }), code('QUEUE_ITEM_NOT_FOUND'));
  await assert.rejects(view(env, { kind: 'file', id: 'invoice_missing' }), code('QUEUE_ITEM_NOT_FOUND'));
  await assert.rejects(view(env, { id: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(view(env, { id: 'plan:x:y', kind: 'thing' }), code('INVALID_VENTURE_REQUEST'));
});

test('invoice.list rows carry the total and its price receipt; client.list carries what the client owes with a sum receipt', async () => {
  const env = await setup();
  const { invoice, clientId } = await withIssuedInvoice(env);
  const [listed] = await run<InvoiceListRow[]>(money, env, 'venture.invoice.list');
  assert.equal(listed.total, 'INR 2,948.82');
  assert.equal(listed.receiptId, invoice.invoice.priceReceiptId);

  const [client] = await run<ClientListRow[]>(money, env, 'venture.client.list');
  assert.equal(client.id, clientId);
  assert.equal(client.owed?.display, 'INR 2,948.82');
  const receipt = await run<SumReceiptRecord>(money, env, 'venture.receipt.get', { id: client.owed!.receiptId });
  assert.equal(receipt.kind, 'venture-sum-receipt');
  assert.deepEqual(receipt.subject, { type: 'owed', clientId });
  assert.equal(receipt.totalMinor, '294882');
  assert.deepEqual(receipt.addends.map(addend => [addend.recordId, addend.amount]), [[invoice.invoice.id, '294882']]);
  assert.equal(receipt.figures[0].display, 'INR 2,948.82');
  assert.equal(receipt.explanation, '1 open invoice: INV-0001 INR 2,948.82. Added together: INR 2,948.82.');
  assert.equal(receipt.stale, false);

  // Asking again finds the same receipt and writes nothing.
  const before = env.store.read().revision;
  const again = await run<ClientListRow[]>(money, env, 'venture.client.list');
  assert.equal(again[0].owed?.receiptId, client.owed!.receiptId);
  assert.equal(env.store.read().revision, before);

  // A part payment changes the sum: a new receipt, and the old one reads stale.
  await run(money, env, 'venture.payment.record', { invoiceId: invoice.invoice.id, amount: '948.82', receivedOn: '2026-10-16', method: 'upi' });
  const [paid] = await run<ClientListRow[]>(money, env, 'venture.client.list');
  assert.equal(paid.owed?.display, 'INR 2,000.00');
  assert.notEqual(paid.owed?.receiptId, client.owed!.receiptId);
  assert.equal((await run<SumReceiptRecord>(money, env, 'venture.receipt.get', { id: client.owed!.receiptId })).stale, true);

  // Paid in full: nothing owed, so no owed field.
  await run(money, env, 'venture.payment.record', { invoiceId: invoice.invoice.id, amount: '2000.00', receivedOn: '2026-10-17', method: 'upi' });
  const [settled] = await run<ClientListRow[]>(money, env, 'venture.client.list');
  assert.equal('owed' in settled, false);
});

test('money.overview: owed, received this month and spent on AI and tools, each a BigInt sum with a receipt', async () => {
  const env = await setup();
  const empty = await setup();
  await seedBlueprint(empty);
  const nothing = await run<MoneyOverview>(money, empty, 'venture.money.overview');
  assert.deepEqual(nothing.lines.map(line => [line.id, line.label, line.value]), [
    ['owed', 'Clients owe you', 'INR 0.00'], ['received', 'Came in this month', 'INR 0.00'], ['spent', 'AI and tools this month', 'USD 0.0000'],
  ]);
  for (const line of nothing.lines) assert.match(line.receiptId!, /^sum_/);

  const { invoice } = await withIssuedInvoice(env);
  await run(money, env, 'venture.payment.record', { invoiceId: invoice.invoice.id, amount: '948.82', receivedOn: '2026-10-16', method: 'upi' });
  // Last month's payment would not count; this month's does.
  await ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => {
    const spend = (phase: SpendRecord['phase'], micros: string, settledBy: SpendRecord['settledBy']) => tx.put<SpendRecord>({
      ...tx.base('venture-spend'), key: `k-${phase}`, item: 'model:anthropic-haiku-5-5', label: `A ${phase} call`, agent: 'delivery', connector: null,
      payer: 'connection:c1', draftDigest: 'd', rate: null, reservedMicros: micros, settledMicros: phase === 'settled' ? micros : null, settledBy,
      phase, quoteId: null, ref: null, refusal: null, settledAt: phase === 'settled' ? tx.now : null,
    });
    spend('settled', '1200', 'bill');
    spend('reserved', '3400', null);
  });
  const overview = await run<MoneyOverview>(money, env, 'venture.money.overview');
  const [owed, received, spent] = overview.lines;
  assert.equal(owed.value, 'INR 2,000.00');
  assert.equal(received.value, 'INR 948.82');
  assert.equal(spent.value, 'USD 0.0046, includes estimates');
  assert.equal(spent.estimate, true, 'a held reservation counts at its estimate');
  const spentReceipt = await run<SumReceiptRecord>(money, env, 'venture.receipt.get', { id: spent.receiptId });
  assert.equal(spentReceipt.unit, 'micros');
  assert.equal(spentReceipt.totalMinor, '4600');
  assert.match(spentReceipt.explanation, /Calls not settled yet count at their estimate\.$/);
  const receivedReceipt = await run<SumReceiptRecord>(money, env, 'venture.receipt.get', { id: received.receiptId });
  assert.deepEqual(receivedReceipt.subject, { type: 'received', from: '2026-10-01', to: '2026-10-31' });
});

test('spend rows say why a call was refused', async () => {
  const env = await setup();
  await seedBlueprint(env);
  await ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => {
    const refused = (key: string, refusal: { code: string; message: string }) => tx.put<SpendRecord>({
      ...tx.base('venture-spend'), key, item: 'connector:x', label: key, agent: null, connector: 'x', payer: 'connector:x', draftDigest: 'd', rate: null,
      reservedMicros: '0', settledMicros: null, settledBy: null, phase: 'refused', quoteId: null, ref: null, refusal, settledAt: null,
    });
    refused('unpriced', { code: 'SPEND_UNPRICED', message: 'No price.' });
    refused('capped', { code: 'SPEND_CAP', message: 'This would go over your monthly limit.' });
  });
  const { rows: listed } = await run<{ rows: SpendRow[] }>(money, env, 'venture.spend.list');
  const reason = (label: string) => listed.find(row => row.label === label)!.reason;
  assert.equal(reason('unpriced'), 'Not run: there is no price for it on your rate card, and Chausar never counts an unknown price as free.');
  assert.equal(reason('capped'), 'Not run. This would go over your monthly limit.');
});

test('evidence.dismiss: a suggestion leaves Today and stays in the ledger marked dismissed; the value in use cannot be dismissed', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { client } = await seedOrder(env, plan);
  const suggestion = await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx =>
    recordEvidence(tx, { subject: `client:${client.id}`, field: 'note', value: 'Prefers calls on Monday', type: 'model-inferred', by: 'agent' }));
  const question = (await rows(env)).find(row => row.kind === 'question');
  assert.ok(question, 'a question row first');
  const read = await view(env, { id: question.id });
  assert.equal(read.kind, 'file');
  assert.deepEqual(read.sections[0].lines, [
    'Suggested: Prefers calls on Monday (the AI inferred this; nothing checked it)', `Where it came from: ${suggestion.source}`, `How sure: ${suggestion.strength}.`,
  ]);
  const { item } = await run<{ item: EvidenceItem }>(core, env, 'venture.evidence.dismiss', { id: suggestion.id });
  assert.equal(item.dismissed, true);
  assert.equal(item.applied, false);
  assert.equal((await rows(env)).some(row => row.kind === 'question'), false);
  // The same value suggested again stays off Today.
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: `client:${client.id}`, field: 'note', value: 'Prefers calls on Monday', type: 'model-inferred', by: 'agent' });
  });
  assert.equal((await rows(env)).some(row => row.kind === 'question'), false);
  const listed = await run<{ items: EvidenceItem[] }>(core, env, 'venture.evidence.list', { subject: `client:${client.id}` });
  assert.equal(listed.items.find(entry => entry.id === suggestion.id)?.dismissed, true);

  const stored = await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx =>
    recordEvidence(tx, { subject: `client:${client.id}`, field: 'note', value: 'Owner note', type: 'owner-entered', by: 'owner' }));
  await assert.rejects(run(core, env, 'venture.evidence.dismiss', { id: stored.id }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(run(core, env, 'venture.evidence.dismiss', { id: 'evidence_missing' }), code('EVIDENCE_NOT_FOUND'));
  await assert.rejects(run(core, env, 'venture.evidence.dismiss', { id: suggestion.id }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('team.posture: tighter than the business stage is stored, looser is refused with POSTURE_ABOVE_STAGE', async () => {
  const env = await setup();
  await seedBlueprint(env);
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'shadow' }), code('POSTURE_ABOVE_STAGE'));
  await setStage(env, 'approve-each');
  const tightened = await call<{ agent: AgentView }>(env, 'venture.team.posture', { agentId: 'delivery', posture: 'shadow' });
  assert.equal(tightened.agent.posture, 'shadow');
  const same = await call<{ agent: AgentView }>(env, 'venture.team.posture', { agentId: 'delivery', posture: 'approve-each' });
  assert.equal(same.agent.posture, 'approve-each');
  // 4J15: auto with spot checks is built but locked (the founder's decision), so it answers AUTO_LOCKED at every rung.
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'auto-spot-check' }), (error: any) => {
    assert.equal(error.code, 'AUTO_LOCKED');
    assert.equal(error.message, "Auto with spot checks is built but locked. It opens after two clean drill runs and the founder's yes.");
    return true;
  });
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'someone', posture: 'shadow' }), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'loose' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'shadow' }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(listRecords(env.store.read(), 'venture-agent-posture').length, 2);
});

test('leads.block: an email or a domain goes on the blocklist, and drafting to it is refused first', async () => {
  const env = await setup();
  const deps: VentureDeps = { ...env.deps, mx: async () => [{ exchange: 'mx.aroma.example', priority: 10 }] };
  const local = { ...env, deps };
  const lead = await run<LeadView>(build, local, 'venture.leads.add', { name: 'Asha Rao', email: 'owner@aroma.example', sourceUrl: 'https://directory.example/pune' });
  assert.deepEqual(await run(build, local, 'venture.leads.block', { value: 'Someone@Other.example' }), { blocked: ['someone@other.example'] });
  assert.deepEqual(await run(build, local, 'venture.leads.block', { value: '@aroma.example' }), { blocked: ['someone@other.example', 'aroma.example'] });
  assert.deepEqual(await run(build, local, 'venture.leads.block', { value: 'aroma.example' }), { blocked: ['someone@other.example', 'aroma.example'] }, 'once');
  await assert.rejects(run(build, local, 'venture.leads.draft', { leadId: lead.id, subject: 'Hello', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' }), code('LEADS_BLOCKED'));
  for (const value of ['', 'not an email', 'x@', 'localhost']) await assert.rejects(run(build, local, 'venture.leads.block', { value }), code('INVALID_VENTURE_REQUEST'), value);
  await assert.rejects(run(build, local, 'venture.leads.block', { value: 'a.example' }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('runs: a rules-judge check nobody settled reads as not checked, never as failed', async () => {
  const unsettled: CheckResult = { check: 'rules-judge', passed: false, detail: 'Not settled: cites-source. A vote without checked evidence never counts as a pass.', notChecked: true };
  assert.equal(checkLabel(unsettled), 'Not checked: Not settled: cites-source. A vote without checked evidence never counts as a pass.');
  // 4J14 (Q7): the judge's own "Failed:" is not said twice.
  assert.equal(checkLabel({ check: 'rules-judge', passed: false, detail: 'Failed: tone.' }), 'Failed: tone.');
  assert.equal(checkLabel({ check: 'house-style', passed: true, detail: 'Fine.' }), 'Passed: Fine.');
});
