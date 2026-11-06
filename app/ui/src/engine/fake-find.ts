/**
 * C2 task 3: the fake engine's venture.find, as platform/runtime/venture/views/find.ts answers it. It reads the fake's
 * own lists of the open business, the rows the owner's screens show (clients, invoices, orders without Chausar's own
 * internal ones, runs), and its Chats through FakeChiefDesk.searchable(), which marks nothing read. Parsing, matching,
 * ranking and snippets are find-core.ts, the engine's own, so both answer and refuse field for field the same.
 */

import { findIn, parseFindRequest, wordsOf, type FindSources } from '../../../../platform/runtime/venture/views/find-core';
import { EngineError, type ClientLite, type FindView, type InvoiceLite, type OrderLite, type RunSummary } from './types';

export interface FindHost {
  /** The open business. */
  current(): string;
  /** One of the fake's own reads, answered as the screen that shows it gets it. */
  read(method: 'venture.client.list' | 'venture.invoice.list' | 'venture.order.list' | 'venture.runs.list', params: Record<string, unknown>): Promise<unknown>;
  chats(): NonNullable<FindSources['chat']>;
}

export class FakeFindDesk {
  constructor(private readonly host: FindHost) {}

  handles(method: string): boolean {
    return method === 'venture.find';
  }

  async request(_method: string, payload: unknown): Promise<FindView> {
    let request;
    try {
      request = parseFindRequest(payload);
    } catch (error) {
      const refusal = error as { code?: string; message?: string };
      throw new EngineError(refusal.code ?? 'INVALID_VENTURE_REQUEST', refusal.message ?? 'Send the words to find.');
    }
    if (!wordsOf(request.text).length) return { groups: [] };
    const clients = await this.host.read('venture.client.list', {}) as ClientLite[];
    const names = new Map(clients.map((client) => [client.id, client.name]));
    const sources: FindSources = {};
    for (const kind of request.kinds) {
      if (kind === 'client') sources.client = clients.map(({ id, name, at }) => ({ id, name, at }));
      else if (kind === 'invoice') {
        sources.invoice = (await this.host.read('venture.invoice.list', {}) as InvoiceLite[]).map((invoice) => ({
          id: invoice.id, number: invoice.number, clientName: names.get(invoice.clientId) ?? null, status: invoice.status, total: invoice.total ?? '', receiptId: invoice.receiptId ?? null, at: invoice.at,
        }));
      } else if (kind === 'order') {
        sources.order = (await this.host.read('venture.order.list', {}) as OrderLite[]).filter((order) => !order.internal)
          .map((order) => ({ id: order.id, request: order.request, clientName: names.get(order.clientId) ?? null, status: order.status, at: order.at }));
      } else if (kind === 'run') {
        // The engine keeps one business per vault; the fake's run list holds every sample business, so it keeps the open one's.
        sources.run = (await this.host.read('venture.runs.list', { state: 'all' }) as { runs: RunSummary[] }).runs.filter((run) => run.businessId === this.host.current())
          .map((run) => ({ id: run.runId, purpose: run.purpose, agentName: run.agent || null, state: run.state, at: run.startedAt }));
      } else {
        sources.chat = this.host.chats();
      }
    }
    return findIn(request, sources);
  }
}
