import test from 'node:test';
import assert from 'node:assert/strict';
import { shopifyAdapters } from '../runtime/writeback/systems/shopify.ts';
import { ShopifyFake, shopifySeed } from '../fakes/shopify/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

const clock = () => '2026-10-14T09:00:00.000Z';
function setup(token = shopifySeed.token, shop = shopifySeed.shop) {
  const fake = new ShopifyFake(shopifySeed, clock);
  const ctx = fakeContext(fake, practiceConnection('shopify', { shop }), { accessToken: token }, clock);
  return { fake, ctx };
}
const small = '4400000000201', item = '4600000000301', location = '7700000000401', tiffin = '8800000000101', tote = '8800000000102';
const writes = (fake: ShopifyFake, method: string) => fake.log.filter(entry => entry.method === method).length;

test('a variant price is set once, read back exactly, and a repeat finds it applied', async () => {
  const { fake, ctx } = setup(); const adapter = shopifyAdapters['variant.price'];
  const first = await cycle(adapter, ctx, { variantId: small, priceMinor: '22950' }, 'effect-key-price-1');
  assert.deepEqual((first.preparation.preview as any).fields, [{ name: 'Price', before: '₹199.00', after: '₹229.50' }]);
  assert.equal(first.preparation.sourceVersion, '2026-10-01T09:00:00.000Z');
  assert.deepEqual(first.preparation.command, { variant: { id: 4400000000201, price: '229.50' } });
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.equal((first.observation as any).observed.priceMinor, '22950');
  assert.equal(fake.products[0].variants[0].price, '229.50'); assert.notEqual(fake.products[0].variants[0].updated_at, '2026-10-01T09:00:00.000Z');
  const again = await cycle(adapter, ctx, { variantId: small, priceMinor: '22950' }, 'effect-key-price-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(writes(fake, 'PUT'), 1);
});

test('a lost stock reply after commit is settled by reading back, with exactly one write', async () => {
  const { fake, ctx } = setup(); const adapter = shopifyAdapters['inventory.set'];
  fake.fault('drop-after-commit');
  const result = await cycle(adapter, ctx, { inventoryItemId: item, locationId: location, available: 25 }, 'effect-key-stock-1');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.deepEqual(result.observation, { outcome: 'confirmed-applied', observed: { inventory_item_id: item, location_id: location, available: 25 }, externalId: `${item}@${location}`, businessSuccess: true });
  assert.equal(writes(fake, 'POST'), 1); assert.equal(fake.inventoryLevels[0].available, 25);
  const again = await cycle(adapter, ctx, { inventoryItemId: item, locationId: location, available: 25 }, 'effect-key-stock-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(writes(fake, 'POST'), 1);
});

test('price, stock and status changes refuse when the target changed between prepare and do', async () => {
  const { fake, ctx } = setup();
  const price = shopifyAdapters['variant.price'], pp = price.validate({ variantId: small, priceMinor: '25000' });
  const pricePrep = await price.prepare(ctx, pp, 'effect-key-price-2');
  fake.products[0].variants[0].updated_at = '2026-10-14T08:59:00.000Z';
  await assert.rejects(price.do(ctx, pp, pricePrep, 'effect-key-price-2'), { code: 'WRITE_PRECONDITION_FAILED' });
  const stock = shopifyAdapters['inventory.set'], sp = stock.validate({ inventoryItemId: item, locationId: location, available: 30 });
  const stockPrep = await stock.prepare(ctx, sp, 'effect-key-stock-2');
  fake.inventoryLevels[0].available = 39;
  await assert.rejects(stock.do(ctx, sp, stockPrep, 'effect-key-stock-2'), { code: 'WRITE_PRECONDITION_FAILED' });
  const status = shopifyAdapters['product.status'], tp = status.validate({ productId: tiffin, status: 'archived' });
  const statusPrep = await status.prepare(ctx, tp, 'effect-key-status-1');
  fake.products[0].status = 'draft';
  await assert.rejects(status.do(ctx, tp, statusPrep, 'effect-key-status-1'), { code: 'WRITE_PRECONDITION_FAILED' });
  assert.equal(writes(fake, 'PUT') + writes(fake, 'POST'), 0);
});

test('a product is listed once and read back by its status', async () => {
  const { fake, ctx } = setup(); const adapter = shopifyAdapters['product.status'];
  const first = await cycle(adapter, ctx, { productId: tote, status: 'active' }, 'effect-key-status-2');
  assert.deepEqual((first.preparation.preview as any).fields, [{ name: 'Status', before: 'draft', after: 'active' }]);
  assert.equal(first.observation.outcome, 'confirmed-applied'); assert.equal(fake.products[1].status, 'active');
  assert.ok((await cycle(adapter, ctx, { productId: tote, status: 'active' }, 'effect-key-status-2')).preparation.alreadyApplied);
  await assert.rejects(cycle(adapter, ctx, { productId: '8800000000999', status: 'active' }, 'effect-key-status-3'), { code: 'WRITE_TARGET_NOT_FOUND' });
});

test('wrong credentials, a bad shop and float-looking values are refused with fixed codes', async () => {
  await assert.rejects(cycle(shopifyAdapters['variant.price'], setup('wrong').ctx, { variantId: small, priceMinor: '100' }, 'effect-key-x-1'), { code: 'WRITE_AUTH_REFUSED' });
  await assert.rejects(cycle(shopifyAdapters['variant.price'], setup(shopifySeed.token, 'Bad.Shop').ctx, { variantId: small, priceMinor: '100' }, 'effect-key-x-2'), { code: 'WRITE_CONNECTION_INCOMPLETE' });
  for (const priceMinor of ['199.00', '1.5', 19900, '-100', '1e4']) assert.throws(() => shopifyAdapters['variant.price'].validate({ variantId: small, priceMinor }), { code: 'INVALID_AMOUNT' });
  for (const available of [1.5, '10', -1, 1000001]) assert.throws(() => shopifyAdapters['inventory.set'].validate({ inventoryItemId: item, locationId: location, available }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => shopifyAdapters['product.status'].validate({ productId: tiffin, status: 'deleted' }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => shopifyAdapters['variant.price'].validate({ variantId: '99999999999999999999', priceMinor: '100' }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => shopifyAdapters['variant.price'].validate({ variantId: small, priceMinor: '100', compare_at_price: '200.00' }), { code: 'INVALID_WRITE_PAYLOAD' });
});
