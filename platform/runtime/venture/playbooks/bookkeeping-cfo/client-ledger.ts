// Client-source ledger isolation after cfo (MIT ideas); original read-only projection into existing W4 calculators.
import { ChausarError, initialState } from '../../../contracts.ts';
import type { VentureRecord } from '../../contracts.ts';
import { BOOKS_SOURCE_ID, digest, isoDate } from '../../records.ts';
import { cfoLedgerPack } from '../../money/cfo-sums.ts';

export type ClientLedgerRow = { id: string; clientId: string; kind: 'receivable' | 'receipt' | 'payment' | 'balance'; on: string; amountMinor: string; dueOn?: string | null; account?: string };
export type ClientLedgerSource = { clientId: string; sourceId: string; rows: readonly ClientLedgerRow[] };

/**
 * Project only the order client's uploaded source into a throwaway state. No service-owner state, costs, AI spend,
 * invoices or bank balances can enter. The records below are read-only projection shapes for the W4 plans, never
 * persisted or presented as issued invoices or bank connections. Receivables are reported outstanding balances.
 */
export function clientLedgerPack(template: VentureRecord, input: ClientLedgerSource, asOf: string) {
  isoDate(asOf, 'Client ledger date');
  if (!input.clientId || !input.sourceId || input.rows.length > 5000 || new Set(input.rows.map(row => row.id)).size !== input.rows.length) throw new ChausarError('CLIENT_LEDGER_INVALID', 'Use one named client source with distinct row ids.');
  if (input.rows.some(row => row.clientId !== input.clientId)) throw new ChausarError('CLIENT_LEDGER_MISMATCH', 'The source contains another client. Split the files before calculating.');
  const state = initialState('Isolated client ledger');
  const venture = { ...template, id: `client-ledger-${digest({ client: input.clientId, source: input.sourceId }).slice(0, 20)}` };
  const currency = template.country.currency;
  const base = (kind: string, id: string, on: string) => ({ id, kind, ventureId: venture.id, memberId: 'client-source', epoch: 0, at: `${on}T00:00:00.000Z` });
  state.conversations.push({ ...base('venture-client', input.clientId, asOf), name: 'The source client' });
  const accounts = new Set<string>();
  const balanceDays = new Set<string>();
  for (const [index, row] of input.rows.entries()) {
    isoDate(row.on, 'Source row day');
    if (row.dueOn != null) isoDate(row.dueOn, 'Source due day');
    if (!row.id || !['receivable', 'receipt', 'payment', 'balance'].includes(row.kind) || !/^-?\d{1,30}$/.test(row.amountMinor) || (row.kind !== 'balance' && BigInt(row.amountMinor) < 0n)) throw new ChausarError('CLIENT_LEDGER_INVALID', 'Read each source row as a non-negative recorded amount with its kind and date.');
    const id = `${input.sourceId}:${row.id}`;
    if (row.kind === 'receivable') {
      state.conversations.push({ ...base('venture-invoice', id, row.on), clientId: input.clientId, number: row.id, status: 'issued', currency, issueDate: row.on, dueDate: row.dueOn ?? null, balanceMinor: row.amountMinor });
    } else if (row.kind === 'receipt') {
      state.conversations.push({ ...base('venture-payment', id, row.on), invoiceId: `source-receipt:${row.id}`, amountMinor: row.amountMinor, currency, receivedOn: row.on, state: 'cleared' });
    } else if (row.kind === 'payment') {
      state.facts.push({ id, entityId: input.clientId, sourceId: BOOKS_SOURCE_ID, sourceRow: index + 1, kind: 'cost', validFrom: row.on, validTo: null, learnedAt: `${row.on}T00:00:00.000Z`, supersededAt: null, fields: { currency, amountMinor: row.amountMinor, taxMinor: '0', description: `Source payment ${row.id}` } });
    } else {
      const accountId = `${input.sourceId}:account:${row.account ?? 'statement'}`;
      const sameDay = `${accountId}:${row.on}`;
      if (balanceDays.has(sameDay)) throw new ChausarError('CLIENT_LEDGER_INVALID', 'Only one closing balance per source account and day can be used.');
      balanceDays.add(sameDay);
      if (!accounts.has(accountId)) { state.conversations.push({ ...base('venture-bank-account', accountId, row.on), currency, label: 'Client statement account' }); accounts.add(accountId); }
      state.conversations.push({ ...base('venture-bank-import', `${id}:balance`, row.on), accountId, transactions: [{ id, date: row.on, amountMinor: '0', currency, balanceAfterMinor: row.amountMinor }] });
    }
  }
  return { ...cfoLedgerPack(state, venture, asOf), clientId: input.clientId, sourceId: input.sourceId };
}
