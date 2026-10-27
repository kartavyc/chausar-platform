/**
 * The fake engine's answers for the chain of an order's stages (Ink v2 wave 5, package 5A1), in the engine's shapes,
 * codes and words (platform/runtime/venture/playbooks/kit/chain.ts orderChainHandler). The fake's businesses run the
 * flagship playbooks, whose offers are not chains of kit stages, so an order the fake knows is refused as the engine
 * refuses it, and one it does not know is not found. A kit business in the fake is a later package's.
 */

import { EngineError } from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.order.chain',
]);
const ONE_OBJECT = 'Send one request object.';
const FIELDS = 'Send the required fields and nothing else.';
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

export class FakeKitChainDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  request(_method: string, p: Record<string, unknown>): unknown {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new EngineError('INVALID_VENTURE_REQUEST', ONE_OBJECT);
    if (!Object.keys(p).every((key) => key === 'orderId') || !Object.hasOwn(p, 'orderId')) throw new EngineError('INVALID_VENTURE_REQUEST', FIELDS);
    if (typeof p.orderId !== 'string' || !ID.test(p.orderId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Order must be a known identifier.');
    const orders = this.host.ask('venture.order.list', {}) as { id: string }[];
    if (!orders.some((order) => order.id === p.orderId)) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
    throw new EngineError('INVALID_VENTURE_REQUEST', "This order's offer runs no stages of a playbook.");
  }
}
