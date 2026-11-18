// Seen in the real app on Windows (15 Nov 2026): venture.books.summary failed SQL_TIMEOUT after 15 s on a business
// with nothing in its books, and took 5.4 s on another. It was a read that wrote: every call made three calculator
// receipts (six for a whole month), each proved by the database in its own process and each committed to the vault,
// so the vault grew about 12 KB per read and nothing was ever reused. The summary is a read now: a sum that counts
// nothing is answered at once with no receipt and nothing written, and a figure whose inputs have not changed opens
// the receipt it already has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculatorService } from '../runtime/calculator.ts';
import { Engine } from '../runtime/engine.ts';
import type { BooksSummary } from '../runtime/venture/contracts.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';

const READS = 5;

/** The calculator with a database proof that counts how often it is asked, as the real app's does its work. */
function counted(env: GoalEnv) {
  const proofs = { asked: 0 };
  (env.deps.services as { calculator: unknown }).calculator = new CalculatorService(env.store, { verifier: async receipt => { proofs.asked += 1; return { verified: true, receiptId: receipt.id }; } });
  return proofs;
}
const sizeOf = (env: GoalEnv) => JSON.stringify(env.store.read()).length;
const summary = (env: GoalEnv, payload: unknown = { period: 'this-month' }) => env.money<BooksSummary>('venture.books.summary', payload);

test('a business with nothing in its books: the summary answers with no receipt, no database proof and nothing written, however often it is read', async () => {
  const env = await goalBusiness();
  const proofs = counted(env);
  const before = { commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) };
  for (let read = 0; read < READS; read += 1) {
    const books = await summary(env);
    assert.deepEqual(books.figures.map(figure => [figure.operation, figure.minor, figure.display, figure.receiptId, figure.stale]),
      [['billed', '0', '₹0', null, false], ['received', '0', '₹0', null, false], ['earned', '0', '₹0', null, false]]);
    assert.deepEqual(books.previous?.figures.map(figure => figure.receiptId), [null, null, null]);
    assert.deepEqual(books.openInvoices, []);
  }
  assert.deepEqual({ commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) }, before);
  assert.equal(proofs.asked, 0);
  assert.equal(env.store.read().receipts.length, 0);
});

test('books with entries: the first read keeps one receipt per figure, and reading again writes nothing and opens the same receipts', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: issued.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  const proofs = counted(env);
  const first = await summary(env);
  // Billed 1975000 before tax and received 100000; nothing is delivered, so earned counts nothing and has no receipt.
  assert.deepEqual(first.figures.map(figure => [figure.operation, figure.minor, typeof figure.receiptId]), [['billed', '1975000', 'string'], ['received', '100000', 'string'], ['earned', '0', 'object']]);
  assert.equal(first.figures[2]!.receiptId, null);
  // September, the month before, holds nothing.
  assert.deepEqual(first.previous?.figures.map(figure => figure.receiptId), [null, null, null]);
  assert.equal(proofs.asked, 2);
  const kept = env.deps.services.calculator.receipt({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }, first.figures[0]!.receiptId!);
  assert.equal(kept.totalMinor, '1975000');

  const before = { commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) };
  for (let read = 0; read < READS; read += 1) {
    const again = await summary(env);
    assert.deepEqual(again.figures.map(figure => [figure.operation, figure.minor, figure.receiptId]), first.figures.map(figure => [figure.operation, figure.minor, figure.receiptId]));
  }
  assert.deepEqual({ commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) }, before);
  assert.equal(proofs.asked, 2);

  // A figure that changed gets a new receipt, once; the one that did not change is proved again once (its old receipt
  // reads as changed), and then reading is quiet again.
  await env.money('venture.payment.record', { invoiceId: issued.invoice.id, amount: '500.00', receivedOn: '2026-10-21', method: 'upi' });
  const changed = await summary(env);
  assert.deepEqual(changed.figures.map(figure => [figure.operation, figure.minor]), [['billed', '1975000'], ['received', '150000'], ['earned', '0']]);
  assert.notEqual(changed.figures[1]!.receiptId, first.figures[1]!.receiptId);
  const after = { commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) };
  for (let read = 0; read < READS; read += 1) assert.deepEqual((await summary(env)).figures.map(figure => figure.receiptId), changed.figures.map(figure => figure.receiptId));
  assert.deepEqual({ commits: env.store.commits, revision: env.store.read().revision, size: sizeOf(env) }, after);
});

test('the calculator on its own still keeps a new receipt each time it is asked to calculate', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-10-01');
  const ctx = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' } as const;
  const request = { operation: 'billed', period: { from: '2026-10-01', to: '2026-10-31' }, currency: 'INR' };
  const one = await env.deps.services.calculator.calculate(ctx, request);
  const two = await env.deps.services.calculator.calculate(ctx, request);
  assert.notEqual(one.id, two.id);
  // Asked as a read, the newest kept receipt for the same work is answered, and nothing is written.
  const commits = env.store.commits;
  const read = await env.deps.services.calculator.calculate(ctx, request, { reuse: true });
  assert.equal(read.id, two.id);
  assert.equal(env.store.commits, commits);
  // An empty sum: null when asked to skip it, a kept receipt (once) when not.
  const empty = { operation: 'earned', period: { from: '2026-10-01', to: '2026-10-31' }, currency: 'INR' };
  assert.equal(await env.deps.services.calculator.calculate(ctx, empty, { reuse: true, skipEmpty: true }), null);
  assert.equal(env.store.commits, commits);
  const zero = await env.deps.services.calculator.calculate(ctx, empty, { reuse: true });
  assert.equal(zero.totalMinor, '0');
  assert.equal((await env.deps.services.calculator.calculate(ctx, empty, { reuse: true })).id, zero.id);
  assert.equal(env.store.commits, commits + 1);
});

test('the real vault: a new business with empty books reads its summary at once, and the vault keeps its revision and its size on disk', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-books-read-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Books Studio', passphrase: 'Synthetic books fixture passphrase', folder: 'books', pack: 'services' });
  await engine.request('venture.create', { idea: 'AC repair and yearly maintenance contracts for offices and housing societies in Lucknow.', countryCode: 'IN' });
  const vaultFile = async () => {
    const sizes: Record<string, number> = {};
    const { readdir } = await import('node:fs/promises');
    for (const name of (await readdir(join(directory, 'books'))).sort()) { const info = await stat(join(directory, 'books', name)); if (info.isFile() && name !== 'writer.lock') sizes[name] = info.size; }
    return sizes;
  };
  const before = { revision: engine.vault!.read().revision, files: await vaultFile() };
  const started = Date.now();
  for (let read = 0; read < READS; read += 1) {
    const books = await engine.request('venture.books.summary', { period: 'this-month' }) as BooksSummary;
    assert.deepEqual(books.figures.map(figure => [figure.minor, figure.receiptId]), [['0', null], ['0', null], ['0', null]]);
  }
  assert.ok(Date.now() - started < 3000, 'five reads of empty books take no time worth naming');
  assert.deepEqual({ revision: engine.vault!.read().revision, files: await vaultFile() }, before);
});
