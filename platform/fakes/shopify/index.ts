/** A stateful Shopify Admin REST (2025-07) shop in memory: products with variants, and inventory levels. */
import { readFileSync } from 'node:fs';
import { HttpFake, body, reply, type Route } from '../http-fake.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';
import { rupees, toPaise } from '../../runtime/writeback/validate.ts';

type Rec = Record<string, any>;
export type ShopifySeed = { shop: string; token: string; products: Rec[]; inventoryLevels: Rec[] };
export const shopifySeed: ShopifySeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/shopify.json', import.meta.url), 'utf8'));
const API = '\\/admin\\/api\\/2025-07';

export class ShopifyFake extends HttpFake {
  readonly system = 'shopify' as const;
  readonly shop: string; readonly token: string;
  products: Rec[]; inventoryLevels: Rec[];
  #clock: () => string; #last = 0;
  constructor(seed: ShopifySeed = shopifySeed, clock: () => string = () => new Date().toISOString()) {
    super(); this.shop = seed.shop; this.token = seed.token; this.#clock = clock;
    this.products = structuredClone(seed.products); this.inventoryLevels = structuredClone(seed.inventoryLevels);
  }
  /** A new updated_at that always moves forward, even within one clock tick. */
  #stamp() { this.#last = Math.max(Date.parse(this.#clock()), this.#last + 1000); return new Date(this.#last).toISOString(); }
  protected authorized(request: WireRequest) { return request.headers['x-shopify-access-token'] === this.token && new URL(request.url).host === `${this.shop}.myshopify.com`; }
  #variant(id: string) { return this.products.flatMap(p => p.variants).find((v: Rec) => String(v.id) === id); }
  #missing() { return reply(404, { errors: 'Not Found' }); }
  #invalid(field: string, message: string) { return reply(422, { errors: { [field]: [message] } }); }
  protected routes(): Route[] {
    return [
      { method: 'GET', path: new RegExp(`^${API}/variants/(\\d+)\\.json$`), write: false, handle: (_r, m) => { const v = this.#variant(m[1]); return v ? reply(200, { variant: v }) : this.#missing(); } },
      { method: 'PUT', path: new RegExp(`^${API}/variants/(\\d+)\\.json$`), write: true, handle: (request, m) => {
        const v = this.#variant(m[1]); if (!v) return this.#missing();
        const b = body(request).variant ?? {};
        if (b.price !== undefined) { if (typeof b.price !== 'string' || !/^\d{1,14}(\.\d{1,2})?$/.test(b.price)) return this.#invalid('price', 'is invalid'); v.price = rupees(toPaise(b.price)); }
        v.updated_at = this.#stamp(); return reply(200, { variant: v });
      } },
      { method: 'GET', path: new RegExp(`^${API}/products/(\\d+)\\.json$`), write: false, handle: (_r, m) => { const p = this.products.find(x => String(x.id) === m[1]); return p ? reply(200, { product: p }) : this.#missing(); } },
      { method: 'PUT', path: new RegExp(`^${API}/products/(\\d+)\\.json$`), write: true, handle: (request, m) => {
        const p = this.products.find(x => String(x.id) === m[1]); if (!p) return this.#missing();
        const b = body(request).product ?? {};
        if (b.status !== undefined) { if (!['active', 'draft', 'archived'].includes(b.status)) return this.#invalid('status', 'is not included in the list'); p.status = b.status; }
        p.updated_at = this.#stamp(); return reply(200, { product: p });
      } },
      { method: 'GET', path: new RegExp(`^${API}/inventory_levels\\.json$`), write: false, handle: (_r, _m, url) => {
        const items = url.searchParams.get('inventory_item_ids')?.split(','), locations = url.searchParams.get('location_ids')?.split(',');
        if (!items && !locations) return this.#invalid('base', 'inventory_item_ids or location_ids is required');
        return reply(200, { inventory_levels: this.inventoryLevels.filter(l => (!items || items.includes(String(l.inventory_item_id))) && (!locations || locations.includes(String(l.location_id)))) });
      } },
      { method: 'POST', path: new RegExp(`^${API}/inventory_levels/set\\.json$`), write: true, handle: request => {
        const b = body(request);
        if (!Number.isSafeInteger(b.available)) return this.#invalid('available', 'must be an integer');
        const l = this.inventoryLevels.find(x => x.inventory_item_id === b.inventory_item_id && x.location_id === b.location_id);
        if (!l) return this.#invalid('base', 'Inventory item is not stocked at the location');
        l.available = b.available; l.updated_at = this.#stamp(); return reply(200, { inventory_level: l });
      } },
    ];
  }
  prime(payload: WireObject, before: WireObject | null) {
    const p = payload as Rec, at = '2026-01-01T00:00:00.000Z';
    if (p.variantId && !this.#variant(p.variantId)) {
      const price = before?.priceMinor ? rupees(String(before.priceMinor)) : '100.00';
      this.products.push({ id: Number(p.variantId) + 1, title: `Practice product ${p.variantId}`, status: 'active', updated_at: at, variants: [{ id: Number(p.variantId), product_id: Number(p.variantId) + 1, title: 'Default Title', price, inventory_item_id: Number(p.variantId) + 2, updated_at: String(before?.updated_at ?? at) }] });
    }
    if (p.productId && !this.products.some(x => String(x.id) === p.productId)) this.products.push({ id: Number(p.productId), title: `Practice product ${p.productId}`, status: String(before?.status ?? 'draft'), updated_at: String(before?.updated_at ?? at), variants: [] });
    if (p.inventoryItemId && p.locationId && !this.inventoryLevels.some(l => String(l.inventory_item_id) === p.inventoryItemId && String(l.location_id) === p.locationId))
      this.inventoryLevels.push({ inventory_item_id: Number(p.inventoryItemId), location_id: Number(p.locationId), available: Number.isSafeInteger(before?.available) ? before!.available : 0, updated_at: at });
  }
  snapshot(): WireObject { return structuredClone({ products: this.products, inventoryLevels: this.inventoryLevels }) as WireObject; }
}
