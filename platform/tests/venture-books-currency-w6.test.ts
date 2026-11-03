import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../runtime/memory.ts';
import { countryProfile } from '../runtime/venture/core/countries.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { booksSummary, booksReceiptFor, BILLED_COVERS_MORE } from '../runtime/venture/money/books.ts';
import { owner, setup } from './venture-views-env.ts';

test('books use the current currency and disclose excluded historical currency without changing facts', async () => {
  const env = await setup();
  await new MemoryService(env.store).append(owner, ['INR', 'USD'].map((currency, index) => ({
    sourceId: 'synthetic-country-history', entityId: `invoice-${currency}`, sourceRow: index + 2, kind: 'invoice',
    validFrom: '2026-10-10', branch: 'main', fields: { amountMinor: index ? '250' : '10000', currency, status: 'issued', orderId: `order-${currency}` },
  })));
  const facts = structuredClone(env.store.read().facts);
  await ventureAction(env.deps, owner, 'admin', 'test.country', tx => { tx.touch({ country: countryProfile('US') }); });
  const books = await booksSummary(env.deps, owner, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(books.currency, 'USD');
  assert.equal(books.figures.find(row => row.operation === 'billed')!.minor, '250');
  assert.match(books.notes.join(' '), /USD.*other currencies.*excluded/i);
  const historical = await booksReceiptFor(env.deps, owner, 'billed', '2026-10-10', 'order-INR', '10000', BILLED_COVERS_MORE, 'INR');
  assert.ok(historical.receiptId);
  assert.equal(env.deps.services.calculator.receipt(owner, historical.receiptId!).currency, 'INR');
  assert.deepEqual(env.store.read().facts, facts);
});
