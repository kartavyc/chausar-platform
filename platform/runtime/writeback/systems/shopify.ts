/**
 * Shopify Admin REST (2025-07) write adapters. The shop sub-domain comes from the connection and
 * the Admin API access token from the credential broker as `X-Shopify-Access-Token`. Prices go
 * on the wire as rupee decimal strings ("199.00") converted exactly from paise and come back
 * through `toPaise`. Every write sets an absolute value and refuses when the target moved.
 */
import { check } from '../../contracts.ts';
import { json, wire } from '../http.ts';
import { account, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, Observation, SystemAdapters, WireObject } from '../types.ts';
import { integer, oneOf, paise, record, rupees, str, text, toPaise } from '../validate.ts';

const ID = /^[1-9][0-9]{0,19}$/;
async function call(ctx: AdapterContext, method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, string> = {}, body?: WireObject) {
  const shop = account(ctx, 'shop', /^[a-z0-9][a-z0-9-]{0,60}$/);
  const url = new URL(`https://${shop}.myshopify.com/admin/api/2025-07${path}`); for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return json(await ctx.http(wire(method, url.toString(), { 'x-shopify-access-token': await secret(ctx, 'accessToken') }, body)));
}
/** A Shopify id as the JSON number its API takes; refuses ids beyond a safe integer. */
function id(value: unknown): string { const digits = text(value, 20, ID); check(Number.isSafeInteger(Number(digits)), 'INVALID_WRITE_PAYLOAD', 'An id is too large to send exactly.'); return digits; }
const same = (observed: unknown, expected: string) => str(observed as any) === expected;
function moved(ok: boolean) { check(ok, 'WRITE_PRECONDITION_FAILED', 'The target changed after the preview. Prepare it again.'); }

type Price = { variantId: string; priceMinor: string };
async function variant(ctx: AdapterContext, variantId: string) {
  const found = (await call(ctx, 'GET', `/variants/${variantId}.json`)).variant;
  check(found && same(found.id, variantId), 'WRITE_TARGET_NOT_FOUND', 'The variant is not in this shop.');
  return { priceMinor: toPaise(found.price), updated_at: str(found.updated_at), title: str(found.title) };
}
const variantPrice: ActionAdapter<any> = {
  validate(payload) { const p = record(payload, ['variantId', 'priceMinor']); return { variantId: id(p.variantId), priceMinor: paise(p.priceMinor) } as Price; },
  async prepare(ctx, p: Price) {
    const v = await variant(ctx, p.variantId);
    return { before: { priceMinor: v.priceMinor, updated_at: v.updated_at }, command: { variant: { id: Number(p.variantId), price: rupees(p.priceMinor) } }, postconditions: { variant_id: p.variantId, priceMinor: p.priceMinor },
      preview: { fields: [{ name: 'Price', before: `₹${rupees(v.priceMinor)}`, after: `₹${rupees(p.priceMinor)}` }] },
      target: { label: `Variant ${v.title}`, ref: p.variantId }, sourceVersion: v.updated_at || null, alreadyApplied: v.priceMinor === p.priceMinor ? { externalId: p.variantId } : null };
  },
  async do(ctx, p: Price, preparation) {
    const v = await variant(ctx, p.variantId);
    moved(v.priceMinor === str(preparation.before?.priceMinor) && v.updated_at === str(preparation.before?.updated_at));
    await call(ctx, 'PUT', `/variants/${p.variantId}.json`, {}, preparation.command);
    return { outcome: 'provider-claims-applied', externalId: p.variantId, data: null };
  },
  async readBack(ctx, p: Price): Promise<Observation> {
    const v = await variant(ctx, p.variantId);
    return v.priceMinor === p.priceMinor ? { outcome: 'confirmed-applied', observed: { variant_id: p.variantId, priceMinor: v.priceMinor }, externalId: p.variantId, businessSuccess: true } : { outcome: 'inconclusive', reason: 'The variant does not show the new price yet.' };
  },
};

type Stock = { inventoryItemId: string; locationId: string; available: number };
async function level(ctx: AdapterContext, p: Stock) {
  const found = ((await call(ctx, 'GET', '/inventory_levels.json', { inventory_item_ids: p.inventoryItemId, location_ids: p.locationId })).inventory_levels ?? []).filter((l: any) => same(l.inventory_item_id, p.inventoryItemId) && same(l.location_id, p.locationId));
  check(found.length === 1, 'WRITE_TARGET_NOT_FOUND', 'The item is not stocked at this location.');
  check(Number.isSafeInteger(found[0].available), 'WRITE_PRECONDITION_FAILED', 'The item does not track stock at this location.');
  return { available: found[0].available as number, updated_at: str(found[0].updated_at) };
}
const inventorySet: ActionAdapter<any> = {
  validate(payload) { const p = record(payload, ['inventoryItemId', 'locationId', 'available']); return { inventoryItemId: id(p.inventoryItemId), locationId: id(p.locationId), available: integer(p.available, 0, 1000000) } as Stock; },
  async prepare(ctx, p: Stock) {
    const l = await level(ctx, p);
    return { before: { available: l.available }, command: { location_id: Number(p.locationId), inventory_item_id: Number(p.inventoryItemId), available: p.available }, postconditions: { inventory_item_id: p.inventoryItemId, location_id: p.locationId, available: p.available },
      preview: { fields: [{ name: 'Available', before: String(l.available), after: String(p.available) }] },
      target: { label: `Stock of item ${p.inventoryItemId} at location ${p.locationId}`, ref: `${p.inventoryItemId}@${p.locationId}` }, sourceVersion: String(l.available), alreadyApplied: l.available === p.available ? { externalId: `${p.inventoryItemId}@${p.locationId}` } : null };
  },
  async do(ctx, p: Stock, preparation) {
    moved((await level(ctx, p)).available === preparation.before?.available);
    await call(ctx, 'POST', '/inventory_levels/set.json', {}, preparation.command);
    return { outcome: 'provider-claims-applied', externalId: `${p.inventoryItemId}@${p.locationId}`, data: null };
  },
  async readBack(ctx, p: Stock): Promise<Observation> {
    const l = await level(ctx, p);
    return l.available === p.available ? { outcome: 'confirmed-applied', observed: { inventory_item_id: p.inventoryItemId, location_id: p.locationId, available: l.available }, externalId: `${p.inventoryItemId}@${p.locationId}`, businessSuccess: true } : { outcome: 'inconclusive', reason: 'The level does not show the new quantity yet.' };
  },
};

const STATUSES = ['active', 'draft', 'archived'] as const;
type Listing = { productId: string; status: typeof STATUSES[number] };
async function product(ctx: AdapterContext, productId: string) {
  const found = (await call(ctx, 'GET', `/products/${productId}.json`)).product;
  check(found && same(found.id, productId), 'WRITE_TARGET_NOT_FOUND', 'The product is not in this shop.');
  return { status: str(found.status), updated_at: str(found.updated_at), title: str(found.title) };
}
const productStatus: ActionAdapter<any> = {
  validate(payload) { const p = record(payload, ['productId', 'status']); return { productId: id(p.productId), status: oneOf(p.status, STATUSES) } as Listing; },
  async prepare(ctx, p: Listing) {
    const found = await product(ctx, p.productId);
    return { before: { status: found.status, updated_at: found.updated_at }, command: { product: { id: Number(p.productId), status: p.status } }, postconditions: { product_id: p.productId, status: p.status },
      preview: { fields: [{ name: 'Status', before: found.status, after: p.status }] },
      target: { label: `Product ${found.title}`, ref: p.productId }, sourceVersion: found.updated_at || null, alreadyApplied: found.status === p.status ? { externalId: p.productId } : null };
  },
  async do(ctx, p: Listing, preparation) {
    const found = await product(ctx, p.productId);
    moved(found.status === str(preparation.before?.status) && found.updated_at === str(preparation.before?.updated_at));
    await call(ctx, 'PUT', `/products/${p.productId}.json`, {}, preparation.command);
    return { outcome: 'provider-claims-applied', externalId: p.productId, data: null };
  },
  async readBack(ctx, p: Listing): Promise<Observation> {
    const found = await product(ctx, p.productId);
    return found.status === p.status ? { outcome: 'confirmed-applied', observed: { product_id: p.productId, status: found.status }, externalId: p.productId, businessSuccess: true } : { outcome: 'inconclusive', reason: 'The product does not show the new status yet.' };
  },
};

export const shopifyAdapters: SystemAdapters = Object.freeze({ 'variant.price': variantPrice, 'inventory.set': inventorySet, 'product.status': productStatus });
