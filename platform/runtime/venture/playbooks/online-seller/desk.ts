import {SELLER_OPERATIONS_DESK,type SellerOperationsDeskTypes} from './operations-desk.ts';
import {SELLER_SHOPIFY_DESK,type SellerShopifyDeskTypes} from './shopify-desk.ts';
import {SELLER_STOREFRONT_DESK,type SellerStorefrontDeskTypes} from './storefront-desk.ts';
// Chausar seller desk. No outside effect; research ideas from sealeap/listing-doctor (MIT), independent code.
import { check } from '../../../contracts.ts';
import { digest, exactPayload, findRecord, listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import type { DeskHandlers, DeskKindTypes } from '../desk-types.ts';
import type { Json, SellerSkuRecord } from '../../contracts.ts';
import type { SellerSkuBody } from './records.ts';
import { filesAddHandler } from '../../delivery/harness/files.ts';
import { sellerFile, sellerImageFiles, sellerCsv, analyseSellerRows, SELLER_MODES, type SellerMode } from './source.ts';
import { sellerTaxSources, sellerIndiaRule } from './rules.ts';
import { sellerWorkReceipt } from './receipt.ts';
import { sellerCall } from './economics.ts';
export type SellerDeskRow = { id: string; orderId: string; mode: SellerMode; sourceName: string; figures: SellerSkuBody['figures'] };
export type OnlineSellerDeskTypes = SellerOperationsDeskTypes & SellerShopifyDeskTypes & SellerStorefrontDeskTypes & { sku: { filter: Json; row: SellerDeskRow; item: SellerSkuRecord; actions: { inspect: { payload: Json; result: SellerSkuRecord } } } & DeskKindTypes };
const row = (record: SellerSkuRecord): SellerDeskRow => ({ id: record.id, orderId: record.orderId, mode: record.mode, sourceName: record.sourceName, figures: record.figures });
export const ONLINE_SELLER_DESK: DeskHandlers = Object.freeze({ ...SELLER_OPERATIONS_DESK, ...SELLER_SHOPIFY_DESK, ...SELLER_STOREFRONT_DESK, sku: {
  async list(deps, ctx, payload) {
    const p = exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']);
    const { state, venture } = readVenture(deps, ctx);
    const filter = p.filter === undefined ? {} : exactPayload(p.filter, ['orderId'], []);
    const rows = listRecords(state, 'venture-seller-sku', venture.id).filter(r => !filter.orderId || r.orderId === filter.orderId).map(row).reverse();
    return { playbook: 'online-seller', kind: 'sku', rows, line: 'Seller checks from the exports you added.' };
  },
  async get(deps, ctx, payload) {
    const p = exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
    const { state, venture } = readVenture(deps, ctx); const item = findRecord(state, 'venture-seller-sku', String(p.id));
    check(item && item.ventureId === venture.id, 'SELLER_REPORT_NOT_FOUND', 'This seller report was not found.');
    return { playbook: 'online-seller', kind: 'sku', item, digest: digest(item) };
  },
  async act(deps, ctx, payload) {
    requireAppChannel(ctx, 'venture.desk.act');
    const p = exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
    check(p.action === 'inspect', 'SELLER_ACTION_INVALID', 'Choose a seller check to run.');
    const body = exactPayload(p.payload, ['orderId', 'name', 'contentBase64', 'mode', 'images', 'economics'], ['orderId', 'name', 'contentBase64', 'mode']);
    check(p.id === body.orderId && SELLER_MODES.includes(body.mode as SellerMode), 'SELLER_INPUT_INVALID', 'Choose an order and a seller check.');
    const { state, venture } = readVenture(deps, ctx); const order = findRecord(state, 'venture-order', String(body.orderId));
    check(order?.ventureId === venture.id && order.status === 'open', 'ORDER_NOT_FOUND', 'Choose an open order in this business.');
    const file = sellerCall(() => sellerFile({ name: body.name, contentBase64: body.contentBase64 }));
    const economics = body.economics === undefined ? null : sellerCall(() => sellerFile(body.economics));
    check(body.mode === 'ads' || !economics, 'SELLER_INPUT_INVALID', 'An economics export belongs only on an ads check.');
    const images = sellerCall(() => sellerImageFiles(body.images));
    check(body.mode === 'listing' || images.length === 0, 'SELLER_INPUT_INVALID', 'Photos belong only on a listing check.');
    const result = sellerCall(() => analyseSellerRows(body.mode as SellerMode, sellerCsv(file.text), { rehearsal: false, ...sellerIndiaRule() }, sellerTaxSources(), images.map(image => ({ name: image.name, ...image.dimensions, source: image.name })), economics ? sellerCsv(economics.text) : undefined));
    const added = await filesAddHandler(deps, ctx, { orderId: order.id, name: file.name, contentBase64: file.contentBase64 });
    const economicsAdded = economics ? await filesAddHandler(deps, ctx, { orderId: order.id, name: economics.name, contentBase64: economics.contentBase64 }) : null;
    for (const image of images) await filesAddHandler(deps, ctx, { orderId: order.id, name: image.name, contentBase64: image.contentBase64 });
    const report = await ventureAction(deps, ctx, 'approve', 'seller.inspect', tx => {
      const live = tx.find('venture-order', order.id); check(live?.status === 'open' && live.ventureId === tx.venture!.id, 'ORDER_NOT_FOUND', 'Choose an open order in this business.');
      const base = tx.base('venture-seller-sku');
      const receipt = { ...tx.base('venture-work-receipt'), ...sellerWorkReceipt({ result, runRef: { kind: 'delivery', runId: base.id }, sourceId: added.id, sourceName: added.name, sourceDigest: added.digest, additionalSources: economicsAdded ? [{ id: economicsAdded.id, name: economicsAdded.name, digest: economicsAdded.digest }] : [] }) };
      tx.put(receipt);
      const record = tx.put({ ...base, orderId: order.id, mode: body.mode as SellerMode, sourceId: added.id, sourceName: added.name, result,
        figures: receipt.figures.map(f => ({ key: f.key, display: f.display, receiptId: receipt.id })), receipt: { inputs: receipt.inputs, steps: receipt.steps, explanation: receipt.explanation } });
      tx.emit('desk.changed', { playbook: 'online-seller', id: record.id }); return record;
    });
    return { playbook: 'online-seller', kind: 'sku', id: report.id, result: report, line: 'The check is ready. Nothing was sent or changed on the marketplace.' };
  },
} });
