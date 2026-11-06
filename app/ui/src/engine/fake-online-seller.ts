import {fakeSellerOperations} from './fake-online-seller-operations';
import {fakeSellerConnectors} from './fake-seller-connectors';
/**
 * Fake seller engine. Uses the exact browser-safe core and source contracts of the real engine.
 * Chausar original code, sealeap/listing-doctor ideas (MIT), no copied source code.
 */
import { EngineError } from './types';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import { SELLER_METADATA, SELLER_TAX_DATA, SELLER_INDIA_DATA } from '../../../../platform/runtime/venture/playbooks/online-seller/metadata';
import { SELLER_MODES, sellerCsv, sellerFile, sellerImageFiles, analyseSellerRows, type SellerMode } from '../../../../platform/runtime/venture/playbooks/online-seller/source';
import { sellerNumbers, sellerPercent } from '../../../../platform/runtime/venture/playbooks/online-seller/model';

import type { SellerSkuBody } from '../../../../platform/runtime/venture/playbooks/online-seller/records';
export const SELLER_FAKE_METADATA = SELLER_METADATA;
type Report = SellerSkuBody & { id: string; kind: 'venture-seller-sku'; ventureId: string; memberId: string; epoch: number; at: string };
function requestObject(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send exactly the fields named in this request.');
  return value as Record<string, unknown>;
}
const fail = (code: string, words: string): never => { throw new EngineError(code, words); };
const formatMinor = (value: string) => { const n = BigInt(value), a = n < 0n ? -n : n; return `INR ${n < 0n ? '-' : ''}${String(a / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100n).padStart(2, '0')}`; };
const display = (key: string, value: string) => key.includes('Minor') ? formatMinor(value) : key.endsWith('Bps') ? sellerPercent(value) : value;
/** Keeps report records by business, with the same refusals and source-file boundary as the engine. */
export function fakeOnlineSellerDesk(host: W4DeskHost): FakePlaybookDesk {
  const operations=fakeSellerOperations(host);
  const connectors=fakeSellerConnectors(host);
  const reports = new Map<string, Report[]>(); let sequence = 0;
  const all = () => reports.get(host.current()) ?? [];
  return { playbook: 'online-seller', forgetPeople: operations.forgetPeople, kinds: { ...operations.kinds, ...connectors.kinds, sku: {
    list(p) {
      requestObject(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']);
      const filter = p.filter === undefined ? {} : requestObject(p.filter, ['orderId'], []);
      return { playbook: 'online-seller', kind: 'sku', rows: all().filter(r => !filter.orderId || r.orderId === filter.orderId).slice().reverse().map(r => ({ id: r.id, orderId: r.orderId, mode: r.mode, sourceName: r.sourceName, figures: r.figures })), line: 'Seller checks from the exports you added.' };
    },
    get(p) {
      requestObject(p, ['playbook', 'kind', 'id']); const item = all().find(r => r.id === p.id);
      if (!item) fail('SELLER_REPORT_NOT_FOUND', 'This seller report was not found.');
      return { playbook: 'online-seller', kind: 'sku', item, digest: host.digest(item) };
    },
    act(p) {
      requestObject(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
      if (p.action !== 'inspect') fail('SELLER_ACTION_INVALID', 'Choose a seller check to run.');
      const body = requestObject(p.payload, ['orderId', 'name', 'contentBase64', 'mode', 'images', 'economics'], ['orderId', 'name', 'contentBase64', 'mode']);
      if (p.id !== body.orderId || !SELLER_MODES.includes(body.mode as SellerMode)) fail('SELLER_INPUT_INVALID', 'Choose an order and a seller check.');
      const orders = host.ask('venture.order.list', {}) as { id: string; status: string }[];
      if (!orders.some(order => order.id === body.orderId && order.status === 'open')) fail('ORDER_NOT_FOUND', 'Choose an open order in this business.');
      let economics: ReturnType<typeof sellerFile> | null = null;
      let file: ReturnType<typeof sellerFile>, result: unknown, images: ReturnType<typeof sellerImageFiles> = [];
      try { economics = body.economics === undefined ? null : sellerFile(body.economics); if (body.mode !== 'ads' && economics) fail('SELLER_INPUT_INVALID', 'An economics export belongs only on an ads check.'); file = sellerFile({ name: body.name, contentBase64: body.contentBase64 }); images = sellerImageFiles(body.images); if (body.mode !== 'listing' && images.length) fail('SELLER_INPUT_INVALID', 'Photos belong only on a listing check.'); result = analyseSellerRows(body.mode as SellerMode, sellerCsv(file.text), { rehearsal: false, ...SELLER_INDIA_DATA }, structuredClone(SELLER_TAX_DATA), images.map(image => ({ name: image.name, ...image.dimensions, source: image.name })), economics ? sellerCsv(economics.text) : undefined); }
      catch (error) { const e = error as Error & { code: string; missing?: unknown }; throw Object.assign(new EngineError(e.code, e.message), e.missing ? { missing: e.missing, details: { missing: e.missing } } : {}); }
      const upload = host.ask('venture.files.add', { orderId: body.orderId, name: file.name, contentBase64: file.contentBase64 }) as { id: string; name: string; digest: string };
      const economicsAdded = economics ? host.ask('venture.files.add', { orderId: body.orderId, name: economics.name, contentBase64: economics.contentBase64 }) as { id: string; name: string; digest: string } : null;
      for (const image of images) host.ask('venture.files.add', { orderId: body.orderId, name: image.name, contentBase64: image.contentBase64 });
      const id = `sellersku_fake_${++sequence}`, receiptId = `work_seller_fake_${sequence}`;
      const figures = Object.entries(sellerNumbers(result)).map(([key, value]) => ({ key, display: display(key, value), receiptId }));
      const values = sellerNumbers(result);
      const record: Report = { id, kind: 'venture-seller-sku', ventureId: `venture_${host.current()}`, memberId: 'owner', epoch: 1, at: host.now(),
        orderId: String(body.orderId), mode: body.mode as SellerMode, sourceId: upload.id, sourceName: upload.name, result, figures,
        receipt: { inputs: { tables: [{ id: upload.id, name: upload.name, digest: upload.digest }, ...(economicsAdded ? [{ id: economicsAdded.id, name: economicsAdded.name, digest: economicsAdded.digest }] : [])], columns: { source: upload.name }, rowIds: [] },
          steps: Object.keys(values).map(key => ({ op: 'compare', inputs: [upload.id, ...(economicsAdded ? [economicsAdded.id] : [])], result: values[key], rule: 'Seller source export, integer minor units, half-up per line.' })), explanation: 'Computed from the seller export. Tax and legal confirmations are required before client use.' } };
      reports.set(host.current(), [...all(), record]);
      host.emit({ type: 'desk.changed', at: host.now(), businessId: host.current() });
      return { playbook: 'online-seller', kind: 'sku', id, result: record, line: 'The check is ready. Nothing was sent or changed on the marketplace.' };
    },
  } } };
}
