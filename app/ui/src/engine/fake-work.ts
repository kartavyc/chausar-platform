/**
 * Orders, delivery runs and client files for the fake engine (the Work place), kept per business. It keeps
 * the engine's rules the screens rely on: an order needs a known client and a priced service from the plan, a file
 * must be CSV, Excel or PDF under the upload limit, delivering twice is refused, and starting a run on an order adds
 * a run the run sheet can show and says so with a `run.started` event.
 */

import { DELIVERIES, ORDERS, UPLOADS } from './fixtures';
import { EngineError, type BlueprintViewLite, type ClientLite, type DeliveryLite, type OrderLite, type RunDetail, type UploadLite, type VentureRunEvent } from './types';

const clone = <T>(value: T): T => structuredClone(value);
/** The engine's limits (platform/runtime/venture/delivery/harness/files.ts). */
const MAX_UPLOAD_BYTES = 1_450_000;
const MAX_UPLOADS_PER_ORDER = 10;
const FORMATS = new Set<UploadLite['format']>(['csv', 'xlsx', 'pdf']);

export interface WorkHost {
  current(): string;
  now(): string;
  /** The open business's clients and plan. */
  clients(): ClientLite[];
  plan(): BlueprintViewLite | null;
  /** The engine's run list: a started run goes to its front. */
  runs(): RunDetail[];
  agentName(): string;
  emit(event: VentureRunEvent): void;
}

const WORK_METHODS = new Set([
  'venture.order.list', 'venture.order.create', 'venture.order.deliver', 'venture.delivery.list', 'venture.delivery.run',
  'venture.files.list', 'venture.files.add',
]);

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export class FakeWorkDesk {
  private readonly host: WorkHost;
  private orders: Record<string, OrderLite[]>;
  private deliveries: Record<string, DeliveryLite[]>;
  private uploads: Record<string, UploadLite[]>;
  private seq = 0;

  constructor(host: WorkHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.orders = options.fresh ? {} : clone(ORDERS);
    this.deliveries = options.fresh ? {} : clone(DELIVERIES);
    this.uploads = options.fresh ? {} : clone(UPLOADS);
  }

  handles(method: string): boolean {
    return WORK_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.order.list': return clone(this.orders[biz] ?? []);
      case 'venture.order.create': return this.create(biz, p);
      case 'venture.order.deliver': return this.deliver(biz, p);
      case 'venture.delivery.list': return clone(this.deliveries[biz] ?? []);
      case 'venture.delivery.run': return this.start(biz, p);
      case 'venture.files.list': return clone((this.uploads[biz] ?? []).filter((u) => typeof p.orderId !== 'string' || (u.scope.kind === 'order' && u.scope.orderId === p.orderId)));
      case 'venture.files.add': return this.addFile(biz, p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private order(biz: string, id: unknown): OrderLite {
    const order = (this.orders[biz] ?? []).find((o) => o.id === id);
    if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
    return order;
  }

  private create(biz: string, p: Record<string, unknown>): OrderLite {
    const client = this.host.clients().find((c) => c.id === p.clientId);
    if (!client) throw new EngineError('CLIENT_NOT_FOUND', 'Add this client first.');
    const plan = this.host.plan();
    if (!plan) throw new EngineError('BLUEPRINT_NOT_FOUND', 'Make your plan first.');
    const offer = plan.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw invalid('That service is not in your plan.');
    if (offer.pricing.unitPriceMinor === null) throw new EngineError('PRICE_REQUIRED', `Set your price for ${offer.name.value} first.`);
    const request = text(p.request);
    if (request.length < 3 || request.length > 4000) throw invalid('The request must be between 3 and 4000 characters.');
    const order: OrderLite = {
      id: `o-new-${++this.seq}`, at: this.host.now(), clientId: client.id, offerId: offer.id,
      quantity: text(p.quantity) || offer.pricing.defaultQuantity, request, status: 'open',
      priceReceiptId: plan.offerReceipts[offer.id]?.id ?? 'R-0415', deliveredOn: null,
    };
    (this.orders[biz] ??= []).unshift(order);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: order.at });
    return clone(order);
  }

  private deliver(biz: string, p: Record<string, unknown>): OrderLite {
    const order = this.order(biz, p.orderId);
    if (order.status === 'cancelled') throw invalid('This order was cancelled.');
    if (order.status === 'delivered' || order.deliveredOn !== null) throw invalid('This order is already marked delivered.');
    if (typeof p.deliveredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.deliveredOn)) throw invalid('Use a date like 2026-10-15.');
    order.deliveredOn = p.deliveredOn;
    order.status = 'delivered';
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return clone(order);
  }

  /** venture.delivery.run: a new run on the order, working (not waiting on the owner), first step current. */
  private start(biz: string, p: Record<string, unknown>): DeliveryLite {
    const order = this.order(biz, p.orderId);
    const runs = this.host.runs();
    const runId = String(Math.max(0, ...runs.map((r) => Number(r.runId)).filter((n) => Number.isInteger(n))) + 1);
    const client = this.host.clients().find((c) => c.id === order.clientId)?.name ?? 'the client';
    const at = this.host.now();
    runs.unshift({
      runId, businessId: biz, agent: this.host.agentName(), purpose: `Draft a reply for ${client}`, state: 'active', startedAt: at, elapsed: '0s',
      progress: { done: 0, total: 3 },
      steps: [
        { id: 'read', purpose: "Read the order and the client's files", state: 'current', elapsed: 'now' },
        { id: 'write', purpose: 'Write the draft', state: 'pending' },
        { id: 'send', purpose: 'Send the draft to you', state: 'pending' },
      ],
    });
    const run: DeliveryLite = { id: runId, at, orderId: order.id, status: 'brief-waiting', practice: false, deliverable: null, verdict: null, awaitingYou: false };
    (this.deliveries[biz] ??= []).unshift(run);
    this.host.emit({ type: 'run.started', businessId: biz, runId, at });
    return clone(run);
  }

  private addFile(biz: string, p: Record<string, unknown>): UploadLite {
    const order = this.order(biz, p.orderId);
    const name = text(p.name);
    const encoded = typeof p.contentBase64 === 'string' ? p.contentBase64 : '';
    const tooBig = new EngineError('UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw tooBig;
    const bytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (bytes <= 0 || bytes > MAX_UPLOAD_BYTES) throw tooBig;
    const format = name.toLowerCase().split('.').pop() as UploadLite['format'];
    if (!name.includes('.') || !FORMATS.has(format)) throw new EngineError('UNSUPPORTED_UPLOAD', 'Add a CSV, Excel or PDF file.');
    const list = (this.uploads[biz] ??= []);
    if (list.filter((u) => u.scope.kind === 'order' && u.scope.orderId === order.id).length >= MAX_UPLOADS_PER_ORDER) throw new EngineError('UPLOAD_LIMIT', 'An order holds at most ten files.');
    const upload: UploadLite = { id: `u-new-${++this.seq}`, at: this.host.now(), name, format, bytes, scope: { kind: 'order', orderId: order.id }, clientData: true };
    list.unshift(upload);
    return clone(upload);
  }
}
