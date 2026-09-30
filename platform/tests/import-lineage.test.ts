import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { defaultRecipe, ImportService, parseZohoJson } from '../runtime/ingest.ts';
import { OntologyService } from '../runtime/ontology.ts';

class TestStore implements StateStore {
  state = initialState('Overlapping independent source exports', true);
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) {
    const draft = structuredClone(this.state);
    const result = await change(draft);
    draft.revision++;
    this.state = draft;
    return result;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const header = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n';
const sale = (id: string, amount: string) => `${id},sale,2026-09-01,${amount},INR,C1,${id},O1,,delivered,Source sale,main`;
async function setup() {
  const store = new TestStore();
  await new OntologyService(store).publish(owner, 'ecommerce');
  return { store, imports: new ImportService(store), calculator: new CalculatorService(store) };
}
function source(rows: string[], amountMinor: string) {
  return { sourceId: 'books', format: 'csv' as const, recipe: defaultRecipe(), content: header + rows.join('\n') + '\n', expectedTotals: { rowCount: rows.length, amountMinor } };
}

// Hand-worked source reports: first A=125.25; second A=125.25+B=200.00=325.25;
// correction A=130.25+B=200.00=330.25. A repeated export must not add revenue.
test('overlapping exports retain all source rows while deduplicating unchanged claims and exact retries', async () => {
  const { store, imports, calculator } = await setup();
  const first = await imports.commit(owner, source([sale('A', '125.25')], '12525'));
  const overlapInput = source([sale('B', '200.00'), sale('A', '125.25')], '32525');
  const overlap = await imports.commit(owner, overlapInput);
  assert.equal(store.read().facts.length, 2, 'The reordered unchanged A claim must not append another version.');
  assert.equal(overlap.coverage.sourceRows, 2);
  assert.equal(overlap.coverage.importedRows, 2);
  assert.equal(overlap.rowIds.length, 2, 'Lineage must cover both rows of the accepted export.');
  assert.equal(new Set(overlap.rowIds).size, 2);
  assert.ok(overlap.rowIds.includes(first.rowIds[0]), 'The existing A claim belongs to both source reports.');
  assert.deepEqual(overlap.rowIds.map((id: string) => store.read().facts.find(f => f.id === id)!.entityId), ['B', 'A']);
  const receipt = await calculator.calculate(owner, { operation: 'earned' });
  assert.equal(receipt.totalMinor, '32525');
  assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.ok(receipt.coverage.importIds.includes(overlap.id));
  const retried = await imports.commit(owner, overlapInput);
  assert.equal(retried.duplicate, true);
  assert.equal(retried.id, overlap.id);
  assert.deepEqual(retried.rowIds, overlap.rowIds);
  assert.equal(store.read().facts.length, 2);
  assert.equal(store.read().imports.length, 2);
  assert.equal((await calculator.calculate(owner, { operation: 'earned' })).totalMinor, '32525');

  const corrected = await imports.commit(owner, source([sale('A', '130.25'), sale('B', '200.00')], '33025'));
  assert.equal(store.read().facts.length, 3, 'Only the corrected A claim needs a new immutable version.');
  assert.equal(corrected.rowIds.length, 2);
  assert.ok(!corrected.rowIds.includes(first.rowIds[0]), 'A new report must reference the corrected A version.');
  assert.equal((await calculator.calculate(owner, { operation: 'earned' })).totalMinor, '33025');
  assert.equal(first.rowIds.length, 1, 'An earlier source report preserves its original lineage.');
});

test('a changed export with entirely unchanged rows has full lineage without appending facts', async () => {
  const { store, imports } = await setup();
  const first = await imports.commit(owner, source([sale('A', '125.25'), sale('B', '200.00')], '32525'));
  const reordered = await imports.commit(owner, source([sale('B', '200.00'), sale('A', '125.25')], '32525'));
  assert.equal(store.read().facts.length, 2);
  assert.equal(store.read().imports.length, 2);
  assert.equal(reordered.rowIds.length, 2);
  assert.deepEqual(reordered.rowIds, [...first.rowIds].reverse());
  assert.equal(reordered.totalsMinor, '32525');
});

test('Zoho exports refuse missing or malformed currency instead of manufacturing INR', async () => {
  const invoice = { invoice_id: 'Z1', date: '2026-09-01', sub_total: '125.25', currency_code: 'INR', status: 'sent' };
  for (const currency_code of [undefined, null, '', 'inr', 'IN', 'INRR', ' INR', 123, true, {}]) {
    assert.throws(() => parseZohoJson(JSON.stringify({ invoices: [{ ...invoice, currency_code }] })), { code: 'MISSING_ZOHO_CURRENCY' });
  }
  const explicit = parseZohoJson(JSON.stringify({ invoices: [invoice, { ...invoice, invoice_id: 'Z2', currency_code: 'USD' }] }));
  assert.deepEqual(explicit.map(row => row.currency), ['INR', 'USD']);
  assert.deepEqual(explicit.map(row => row.amount), ['125.25', '125.25']);

  const { store, imports } = await setup();
  const content = JSON.stringify({ invoices: [{ ...invoice, currency_code: undefined }] });
  await assert.rejects(imports.commit(owner, { sourceId: 'zoho', format: 'zoho-json', content, expectedTotals: { rowCount: 1, amountMinor: '12525' } }), { code: 'MISSING_ZOHO_CURRENCY' });
  assert.equal(store.read().facts.length, 0);
  assert.equal(store.read().imports.length, 0);
});

test('omitted source amounts produce row refusals even when the source total is zero', async () => {
  const { store, imports } = await setup();
  const recipe = defaultRecipe();
  recipe.bindings.find(b => b.target === 'amountMinor')!.nulls = 'omit';
  const missingInputs = [
    { sourceId: 'blank-cell', format: 'csv' as const, content: 'id,kind,date,amount,currency\nA,sale,2026-09-01,,INR\n' },
    { sourceId: 'absent-column', format: 'csv' as const, content: 'id,kind,date,currency\nA,sale,2026-09-01,INR\n' },
    { sourceId: 'null-json', format: 'zoho-json' as const, content: JSON.stringify({ invoices: [{ invoice_id: 'Z1', date: '2026-09-01', sub_total: null, subtotal: null, currency_code: 'INR' }] }) },
  ];
  for (const input of missingInputs) {
    const request = { ...input, recipe, expectedTotals: { rowCount: 1, amountMinor: '0' } };
    const preview = imports.preview(owner, request);
    assert.equal(preview.accepted, false);
    assert.ok(preview.errors.some(e => e.row === 2 && e.code === 'MISSING_MEASURE_VALUE'));
    assert.equal(preview.facts.length, 0);
    assert.equal(preview.coverage.importedRows, 0);
    assert.equal(preview.coverage.rejectedRows, 1);
    assert.equal(preview.coverage.reconciled, false);
    await assert.rejects(imports.commit(owner, request), { code: 'IMPORT_REFUSED' });
  }
  const nonzeroReport = imports.preview(owner, { ...missingInputs[0], recipe, expectedTotals: { rowCount: 1, amountMinor: '12525' } });
  assert.ok(nonzeroReport.errors.some(e => e.code === 'MISSING_MEASURE_VALUE'));
  assert.ok(nonzeroReport.errors.some(e => e.code === 'SOURCE_TOTAL_MISMATCH'));
  assert.equal(store.read().facts.length, 0);
  assert.equal(store.read().imports.length, 0);
});

test('an explicit zero mapping reconciles as a known zero amount and still checks the source total', async () => {
  const { store, imports, calculator } = await setup();
  const recipe = defaultRecipe();
  recipe.bindings.find(b => b.target === 'amountMinor')!.nulls = 'zero';
  const input = { sourceId: 'zero-mapping', format: 'csv' as const, recipe, content: 'id,kind,date,amount,currency\nA,sale,2026-09-01,,INR\n', expectedTotals: { rowCount: 1, amountMinor: '0' } };
  const preview = imports.preview(owner, input);
  assert.equal(preview.accepted, true);
  assert.equal(preview.facts[0].fields.amountMinor, '0');
  assert.equal(preview.coverage.importedRows, 1);
  assert.equal(preview.coverage.rejectedRows, 0);
  const mismatched = imports.preview(owner, { ...input, expectedTotals: { rowCount: 1, amountMinor: '12525' } });
  assert.equal(mismatched.accepted, false);
  assert.ok(mismatched.errors.some(e => e.code === 'SOURCE_TOTAL_MISMATCH'));
  const committed = await imports.commit(owner, input);
  assert.equal(committed.rowIds.length, 1);
  assert.equal(store.read().facts.length, 1);
  const receipt = await calculator.calculate(owner, { operation: 'earned' });
  assert.equal(receipt.totalMinor, '0');
  assert.equal(receipt.coverage.countedRows, 1);
  assert.equal(receipt.coverage.completeness, 'reconciled-imports');
});
