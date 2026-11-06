// Chausar venture launcher, C2 task 2: venture.find { text, kinds?, limit? } (read), what the command bar finds in the
// open business. It authorizes as the lists do (readAs 'read' on the one open business) and reads one snapshot. Each
// kind keeps exactly what its list shows the owner, from the same records with the same filters: clients and orders
// newest first (without Chausar's own internal orders), invoices only once the business has a country, with the list's
// total (formatted by code) and price receipt, chats with their state now (searchableThreads, which never marks an
// answer read), and runs from venture.runs.list { state: 'all' } itself. The client, invoice and order lists are not
// called: the client list seals a sum receipt for a client who owes money (a find writes nothing), and the invoice and
// order lists work out each row's next step, which a find does not show and which costs seconds on a few thousand rows.
// Matching, ranking and snippets are find-core.ts findIn, which the fake runs on its own lists. It emits nothing.
import { ChausarError, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { formatMoney } from '../../owner-format.ts';
import { hasCountry } from '../money/figure-kinds.ts';
import { listRecords } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { findIn, parseFindRequest, wordsOf, type FindSources, type FindView } from './find-core.ts';

/** A list that refuses this caller leaves its kind out of the find; any other failure is the find's. */
const LEFT_OUT = new Set(['FORBIDDEN', 'APP_APPROVAL_REQUIRED']);

const newestFirst = <T extends { at: string }>(records: readonly T[]): T[] => [...records].sort((a, b) => b.at.localeCompare(a.at));

/** venture.find (read): the open business's clients, invoices, orders, runs and chats that match, best kind first. */
export async function findHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FindView> {
  const request = parseFindRequest(payload);
  const { state, venture } = readAs(deps, ctx, 'read');
  if (!wordsOf(request.text).length) return { groups: [] };
  const clients = newestFirst(listRecords(state, 'venture-client', venture.id));
  const names = new Map(clients.map(client => [client.id, client.name]));
  const sources: FindSources = {};
  for (const kind of request.kinds) {
    try {
      if (kind === 'client') sources.client = clients;
      else if (kind === 'invoice') {
        sources.invoice = !hasCountry(venture) ? [] : newestFirst(listRecords(state, 'venture-invoice', venture.id)).map(invoice => ({
          id: invoice.id, number: invoice.number, clientName: names.get(invoice.clientId) ?? null, status: invoice.status,
          total: formatMoney(invoice.totalMinor, invoice.currency), receiptId: invoice.priceReceiptId, at: invoice.at,
        }));
      } else if (kind === 'order') {
        sources.order = newestFirst(listRecords(state, 'venture-order', venture.id)).filter(order => !order.internal)
          .map(order => ({ id: order.id, request: order.request, clientName: names.get(order.clientId) ?? null, status: order.status, at: order.at }));
      } else if (kind === 'run') {
        const { runsListHandler } = await import('./runs.ts');
        sources.run = (await runsListHandler(deps, ctx, { state: 'all' })).runs
          .map(run => ({ id: run.runId, purpose: run.purpose, agentName: run.agent || null, state: run.state, at: run.startedAt }));
      } else {
        const { searchableThreads } = await import('../chief/threads.ts');
        sources.chat = searchableThreads(state, venture, deps.clock().toISOString());
      }
    } catch (error) {
      if (error instanceof ChausarError && LEFT_OUT.has(error.code)) continue;
      throw error;
    }
  }
  return findIn(request, sources);
}
