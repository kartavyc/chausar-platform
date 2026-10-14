/**
 * Base for stateful fake systems that serve a provider's HTTP API from memory. Fakes are wired
 * only in tests, demo mode and Practice: production code never imports this folder.
 */
import { ChausarError } from '../runtime/contracts.ts';
import { redact } from '../runtime/writeback/http.ts';
import type { SystemId, Transport, WireObject, WireRequest, WireResponse } from '../runtime/writeback/types.ts';

export type Route = { method: string; path: RegExp; write: boolean; handle(request: WireRequest, match: RegExpMatchArray, url: URL): WireResponse };
export const reply = (status: number, body: unknown, headers: Record<string, string> = {}): WireResponse => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

export abstract class HttpFake {
  abstract readonly system: SystemId;
  readonly log: { method: string; target: string; body: string | null }[] = [];
  #fault: 'drop-after-commit' | 'fail-before-commit' | 'none' = 'none';
  /** The credential this fake accepts, as the real system would check it. */
  protected abstract authorized(request: WireRequest): boolean;
  protected abstract routes(): Route[];
  abstract prime(payload: WireObject, before: WireObject | null): void;
  abstract snapshot(): WireObject;
  fault(kind: 'drop-after-commit' | 'fail-before-commit' | 'none') { this.#fault = kind; }
  readonly transport: Transport = async request => {
    this.log.push(redact(request));
    const url = new URL(request.url);
    if (!this.authorized(request)) return reply(401, { message: 'unauthorized' });
    for (const route of this.routes()) {
      const match = route.method === request.method ? url.pathname.match(route.path) : null;
      if (!match) continue;
      if (route.write && this.#fault === 'fail-before-commit') { this.#fault = 'none'; throw new ChausarError('FAKE_CONNECTION_LOST', 'The practice connection was cut before the system received the request.'); }
      const response = route.handle(request, match, url);
      if (route.write && this.#fault === 'drop-after-commit') { this.#fault = 'none'; throw new ChausarError('FAKE_CONNECTION_LOST', 'The practice connection was cut after the system applied the request.'); }
      return response;
    }
    return reply(404, { message: 'not found' });
  };
}
export function body(request: WireRequest): any { try { return request.body ? JSON.parse(request.body) : {}; } catch { return {}; } }
