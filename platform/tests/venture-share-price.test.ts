// Ink v2 wave 5, package 5A2: share prices (founder decision of 23 Oct; catalogue 2.9.0 "share price kind": a recruiting
// success fee, a reimbursement audit share, a support desk's AI pass-through markup). A share is basis points the owner
// sets, of a base taken from a recorded amount with its evidence file, worked out in BigInt and rounded half up to the
// paisa. Setting or changing a share is a price change: it waits on Today and asks twice, like any price.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, QueueList, QueueRow, UploadRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { quoteShare } from '../runtime/venture/money/quote.ts';
import { shareQuote, sharePercentBps, shareWords } from '../runtime/venture/money/share-price.ts';
import { call, code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<any>;
const update = (env: Env, patch: Record<string, unknown>) => (core as Record<string, Handler>)['venture.blueprint.update'](env.deps, owner, { patch });
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const latest = (env: Env): BlueprintRecord => listRecords(env.store.read(), 'venture-blueprint').sort((a, b) => b.version - a.version)[0];

async function upload(env: Env, name = 'offer-letter.pdf'): Promise<UploadRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.upload', tx => tx.put<UploadRecord>({
    ...tx.base('venture-upload'), name, format: 'pdf', bytes: 4, digest: 'd'.repeat(64), contentBase64: 'JVBERg==',
    scope: { kind: 'order', orderId: 'order_x' }, clientData: true,
  } as UploadRecord));
}

test('quoteShare: 8.33% of 12,00,000.00 rupees is 99,960.00 rupees, in BigInt, half up to the paisa', () => {
  assert.equal(quoteShare({ bps: '833', baseMinor: '120000000' }), '9996000');
  // Half up: 1% of 0.50 rupees is half a paisa, which rounds up to one paisa; 1% of 0.49 rupees rounds down to none.
  assert.equal(quoteShare({ bps: '100', baseMinor: '50' }), '1');
  assert.equal(quoteShare({ bps: '100', baseMinor: '49' }), '0');
  // The whole amount at 100%, and far past what a double could hold exactly.
  assert.equal(quoteShare({ bps: '10000', baseMinor: '123456789' }), '123456789');
  assert.equal(quoteShare({ bps: '1', baseMinor: '900719925474099300' }), '90071992547410');
});

test('quoteShare refuses a missing base, and a share or a base that is not whole positive text', () => {
  assert.throws(() => quoteShare({ bps: '833', baseMinor: null }), code('SHARE_BASE_MISSING'));
  assert.throws(() => quoteShare({ bps: '833', baseMinor: undefined }), code('SHARE_BASE_MISSING'));
  for (const bps of ['0', '10001', '8.33', '-5', '']) assert.throws(() => quoteShare({ bps, baseMinor: '100' }), code('INVALID_SHARE'), bps);
  for (const baseMinor of ['0', '-1', '12.5', 'ten']) assert.throws(() => quoteShare({ bps: '833', baseMinor }), code('INVALID_AMOUNT'), baseMinor);
});

test('the share the owner types: percent text to basis points, and back to plain words', () => {
  assert.equal(sharePercentBps('8.33'), '833');
  assert.equal(sharePercentBps('12'), '1200');
  assert.equal(sharePercentBps('0.5 %'), '50');
  for (const typed of ['0', '0.00', '100.01', '8.333', 'eight', '']) assert.throws(() => sharePercentBps(typed), code('INVALID_SHARE'), typed);
  assert.equal(shareWords('833'), '8.33% of the amount your client confirms');
  assert.equal(shareWords('1200'), '12% of the amount your client confirms');
});

test('a share quote needs a recorded base and its evidence file in this business; then it is a receipt with its working', async () => {
  const env = await setup();
  const file = await upload(env);
  const state = () => env.store.read();
  const price = { kind: 'share' as const, bps: '833', baseMinor: null, baseEvidenceFileId: file.id, words: '8.33% of the amount your client confirms' };
  assert.throws(() => shareQuote(state(), env.venture, price), (error: any) => {
    assert.equal(error.code, 'SHARE_BASE_MISSING');
    assert.equal(error.message, 'Record the amount this share is of first, with the file that shows it.');
    return true;
  });
  assert.throws(() => shareQuote(state(), env.venture, { ...price, baseMinor: '120000000', baseEvidenceFileId: null }), (error: any) => {
    assert.equal(error.code, 'SHARE_BASE_UNPROVEN');
    assert.equal(error.message, 'Add the file that shows this amount, such as the offer letter or the refund order.');
    return true;
  });
  assert.throws(() => shareQuote(state(), env.venture, { ...price, baseMinor: '120000000', baseEvidenceFileId: 'upload_elsewhere' }), code('SHARE_BASE_UNPROVEN'));

  const quote = shareQuote(state(), env.venture, { ...price, baseMinor: '120000000' });
  assert.equal(quote.shareMinor, '9996000');
  assert.equal(quote.currency, 'INR');
  assert.deepEqual(quote.figures.map(figure => [figure.key, figure.minor, figure.display]), [['base', '120000000', 'INR 1,200,000.00'], ['share', '9996000', 'INR 99,960.00']]);
  assert.deepEqual(quote.steps, [
    { op: 'multiply', inputs: ['120000000', '833'], resultMinor: '9996000', rule: 'the amount times the share in basis points, over 10000, rounded half up to the minor unit' },
  ]);
  assert.equal(quote.explanation, '8.33% of INR 1,200,000.00 (shown by offer-letter.pdf) = INR 99,960.00.');
  assert.match(quote.digest, /^[a-f0-9]{64}$/);
  assert.ok(quote.allowedNumbers.includes('99960.00') && quote.allowedNumbers.includes('8.33'));
});

test('setting a share is a price change: the plan keeps it as the offer\'s price, and Today asks twice before it is used', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  await update(env, { offers: [{ id: 'offer_2', share: { percent: '8.33' } }] });
  const offer = latest(env).offers.find(item => item.id === 'offer_2')!;
  assert.deepEqual(offer.pricing.share, { kind: 'share', bps: '833', baseMinor: null, baseEvidenceFileId: null, words: '8.33% of the amount your client confirms' });
  assert.equal(offer.pricing.unitPriceMinor, null, 'a share and a fixed price never stand together');
  assert.equal(offer.pricing.unitPriceLabel, 'not-set');

  const rows = (await list(env)).rows;
  const price = rows.find(row => row.kind === 'price') as QueueRow;
  assert.ok(price, 'the change waits on Today');
  assert.equal(price.title, 'New price for Catch up clean up');
  assert.deepEqual(price.change, { label: 'Catch up clean up', before: 'INR 15,000.00 per project', after: '8.33% of the amount your client confirms' });
  assert.deepEqual(price.actions.map(action => [action.id, action.primary, action.secondAsk ?? false]), [['read', false, false], ['approve', true, true]]);
  // The row's counted change and its receipt (4J1) say the share in the same words.
  assert.ok(price.changeCount?.details.includes('Catch up clean up: INR 15,000.00 per project to 8.33% of the amount your client confirms'), JSON.stringify(price.changeCount));
  const proof = await (money as Record<string, Handler>)['venture.receipt.get'](env.deps, owner, { id: `fig:plan:${latest(env).id}` });
  assert.match(proof.explanation, /Catch up clean up is INR 15,000\.00 per project in the plan in use and 8\.33% of the amount your client confirms in version 2/);
  // An offer priced as a share has its price: Today does not ask the owner to set one.
  assert.equal(rows.filter(row => row.kind === 'setup' && /no price yet/.test(row.line ?? '')).length, 0);

  // Accepting it on Today makes the share the plan's price.
  const accepted = await call<{ outcome: string }>(env, 'venture.queue.decide', { id: price.id, digest: price.digest, action: 'approve' });
  assert.equal(accepted.outcome, 'done');
  assert.equal(listRecords(env.store.read(), 'venture-blueprint').find(item => item.status === 'accepted' && item.version === latest(env).version)?.offers[1].pricing.share?.bps, '833');

  // Changing the share is a price change too; a fixed price takes the share away.
  await update(env, { offers: [{ id: 'offer_2', share: { percent: '10' } }] });
  assert.deepEqual((await list(env)).rows.find(row => row.kind === 'price')?.change, { label: 'Catch up clean up', before: '8.33% of the amount your client confirms', after: '10% of the amount your client confirms' });
  await update(env, { offers: [{ id: 'offer_2', unitPrice: '20000' }] });
  const fixed = latest(env).offers.find(item => item.id === 'offer_2')!;
  assert.equal(fixed.pricing.share, undefined);
  assert.equal(fixed.pricing.unitPriceMinor, '2000000');
  // A share and a fixed price in one change are refused; so is a share the owner did not type as a percent.
  await assert.rejects(update(env, { offers: [{ id: 'offer_2', share: { percent: '5' }, unitPrice: '100' }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(update(env, { offers: [{ id: 'offer_2', share: { percent: '120' } }] }), code('INVALID_SHARE'));
  await assert.rejects(update(env, { offers: [{ id: 'offer_2', share: { bps: '833' } }] }), code('INVALID_VENTURE_REQUEST'));
  // null takes a share away and leaves the offer unpriced.
  await update(env, { offers: [{ id: 'offer_2', share: { percent: '5' } }] });
  await update(env, { offers: [{ id: 'offer_2', share: null }] });
  const cleared = latest(env).offers.find(item => item.id === 'offer_2')!;
  assert.equal(cleared.pricing.share, undefined);
  assert.equal(cleared.pricing.unitPriceMinor, null);
});
