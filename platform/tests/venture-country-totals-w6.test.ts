import test from 'node:test';
import assert from 'node:assert/strict';
import { countryProfile } from '../runtime/venture/core/countries.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import type { GoalRecord, BillResult, BankLedgerView, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { bankApply, bankImport, bankLedger } from '../runtime/venture/build/bank-methods.ts';
import { goalView } from '../runtime/venture/money/goals.ts';
import { clientStatement, statementPlan } from '../runtime/venture/money/statement.ts';
import { statementText } from '../runtime/venture/build/share-links.ts';
import { taxWorking } from '../runtime/venture/money/tax-working.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { owner } from './venture-views-env.ts';

async function movedBusiness() {
  const env = await goalBusiness();
  const original = await invoice(env, '1', '2026-10-01');
  await ventureAction(env.deps, owner, 'admin', 'test.country', tx => {
    tx.touch({ originalCountry: tx.venture!.country, country: countryProfile('US') });
  });
  return { ...env, original };
}

test('an old invoice balance keeps its currency and the current-currency client statement discloses omissions', async () => {
  const env = await movedBusiness();
  const state = env.store.read(), venture = currentVenture(state)!;
  const plan = statementPlan(state, venture, { type: 'statement', clientId: env.client.id, part: 'balance', invoiceId: env.original.invoice.id });
  assert.equal(plan.currency, 'INR');
  assert.equal(plan.addends.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString(), env.original.invoice.balanceMinor);
  const statement = clientStatement(state, env.client.id, '2026-10-23');
  assert.equal(statement.currency, 'USD');
  assert.equal(statement.owed.minor, '0');
  assert.match(statementText(statement, venture), /USD.*other currencies.*excluded/i);
});

test('country changes leave the historical goal intact and ask for a new current-currency goal', async () => {
  const env = await movedBusiness();
  await ventureAction(env.deps, owner, 'admin', 'test.old-goal', tx => {
    tx.put<GoalRecord>({ ...tx.base('venture-goal'), month: '2026-10', amountMinor: '15000000', currency: 'INR', by: 'owner' });
  });
  const view = await goalView(env.deps, owner, '2026-10');
  assert.equal(view.state, 'unset');
  assert.match(view.line, /INR.*USD/);
  assert.match(view.line, /other currencies.*excluded/i);
  assert.equal(listRecords(env.store.read(), 'venture-goal')[0].currency, 'INR');
});

test('an unset goal discloses other currencies excluded from its previous-month comparison', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-09-01');
  await ventureAction(env.deps, owner, 'admin', 'test.country', tx => { tx.touch({ originalCountry: tx.venture!.country, country: countryProfile('US') }); });
  const view = await goalView(env.deps, owner, '2026-10');
  assert.equal(view.state, 'unset');
  assert.match(view.lastMonth!.display, /USD/);
  assert.match(view.line, /other currencies.*excluded/i);
});

test('current plan tax words never relabel tax on a historical invoice', async () => {
  const env = await movedBusiness();
  await ventureAction(env.deps, owner, 'admin', 'test.new-plan', tx => {
    const original = tx.list('venture-blueprint')[0];
    tx.put({ ...original, ...tx.base('venture-blueprint'), version: original.version + 1, country: countryProfile('US'),
      backOffice: { ...original.backOffice, taxLabel: 'Sales tax' } });
  });
  const view = await taxWorking(env.deps, owner, { period: '2026-10' });
  const line = view.sections.flatMap(section => section.lines).find(row => row.label.includes(env.original.invoice.number!))!;
  assert.match(line.value, /^GST INR/);
  assert.doesNotMatch(line.value, /Sales tax/);
  assert.equal(view.sections[0].title, 'Tax');
  const total = view.sections[0].lines.find(row => row.label.startsWith('GST on invoices'))!;
  assert.ok(total.receiptId);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: total.receiptId });
  assert.equal(receipt.currency, 'INR');
  assert.equal(receipt.totalMinor, env.original.invoice.taxMinor);
  assert.deepEqual(receipt.addends.map(row => row.recordId), [env.original.invoice.id]);
  await ventureAction(env.deps, owner, 'admin', 'test.void', tx => { tx.replace({ ...tx.find('venture-invoice', env.original.invoice.id)!, status: 'void' }); });
  assert.equal((await env.money<SumReceiptRecord>('venture.receipt.get', { id: total.receiptId })).stale, true);
});

test('new-currency bill and bank costs retain exact calculator receipts', async () => {
  const env = await movedBusiness();
  const bill = await env.money<BillResult>('venture.bills.add', { vendor: 'Sample hosting', lines: [{ description: 'Hosting', amountMinor: '250', taxName: '', taxRateBps: '0' }], billDate: '2026-10-20', dueDate: '2026-10-20' });
  const paid = await env.money<BillResult>('venture.bills.pay', { billId: bill.bill.id, amountMinor: '250', paidOn: '2026-10-20', method: 'bank-transfer' });
  assert.ok(paid.receiptId);
  const receipt = env.deps.services.calculator.receipt(owner, paid.receiptId);
  assert.deepEqual([receipt.currency, receipt.totalMinor], ['USD', '250']);
  await bankImport(env.deps, owner, { csv: 'Date,Description,Amount,Counterparty\n2026-10-21,SAMPLE HOST,-3.00,Sample host\n', account: 'Sample account' });
  const ledger = await bankLedger(env.deps, owner, {}) as BankLedgerView;
  const cost = await bankApply(env.deps, owner, { transactionId: ledger.rows[0].id, as: 'cost' });
  assert.ok(cost.receiptId);
  const bankReceipt = env.deps.services.calculator.receipt(owner, cost.receiptId);
  assert.deepEqual([bankReceipt.currency, bankReceipt.totalMinor], ['USD', '300']);
});
